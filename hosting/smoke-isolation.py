#!/usr/bin/env python3
"""Start TWO disposable companies behind localhost HTTPS and prove data/cookie isolation.

Requires the built image, Docker Compose, OpenSSL and curl. No live state/DNS is
used. The script removes only its uniquely named containers/volumes on completion.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import time
import uuid

import provision


def synthetic_pdf(path):
    stream = b'BT /F1 12 Tf 40 700 Td (Generiek testproces: controleer aanvraag en publiceer akkoord.) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    data, offsets = b'%PDF-1.4\n', [0]
    for number, value in enumerate(objects, 1):
        offsets.append(len(data))
        data += str(number).encode() + b' 0 obj\n' + value + b'\nendobj\n'
    position = len(data)
    data += b'xref\n0 6\n0000000000 65535 f \n'
    data += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    data += f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{position}\n%%EOF\n'.encode()
    path.write_bytes(data)


def archive_manifest(path):
    """Compare restored bytes and ownership before the app touches its database."""
    manifest = {}
    with tarfile.open(path) as archive:
        for member in archive:
            name = member.name.removeprefix('./')
            if member.name.startswith('/') or '..' in Path(name).parts or member.issym() or member.islnk():
                raise AssertionError('Onveilig pad in de synthetische testsnapshot.')
            if member.isfile():
                with archive.extractfile(member) as stream:
                    checksum = hashlib.sha256()
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        checksum.update(chunk)
                    digest = checksum.hexdigest()
                manifest[name] = (member.size, member.mode, member.uid, member.gid, digest)
    assert manifest, 'Lege testsnapshot.'
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='service-procesgids:local')
    args = parser.parse_args()
    for tool in ('docker', 'openssl', 'curl'):
        if not shutil.which(tool):
            raise SystemExit(f'{tool} ontbreekt in PATH.')
    project = 'spg-smoke-' + uuid.uuid4().hex[:12]
    temporary = tempfile.TemporaryDirectory(prefix=project + '-')
    state = Path(temporary.name).resolve()
    companies = [{'slug': 'alpha', 'domain': 'alpha.localhost', 'network': 241}, {'slug': 'beta', 'domain': 'beta.localhost', 'network': 242}]
    for company in companies:
        provision.create_certificate(state / 'secrets' / company['slug'], company['slug'])
    document = provision.compose_document(state, companies)
    document['name'] = project
    document['services']['proxy']['ports'] = ['127.0.0.1::443']
    for name, volume in document['volumes'].items():
        volume['name'] = project + '-' + name
    for company in companies:
        app = document['services']['app-' + company['slug']]
        app.pop('build')
        app['image'] = args.image
        app['restart'] = 'no'
    compose_file = state / 'compose.json'
    provision.atomic_json(compose_file, document)
    (state / 'Caddyfile').write_text('{\n  local_certs\n  skip_install_trust\n}\n' + '\n'.join(
        f"https://{c['domain']} {{\n  tls internal\n  reverse_proxy app-{c['slug']}:8080\n}}\n" for c in companies))
    command = ['docker', 'compose', '-f', str(compose_file)]

    def compose(*arguments, **kwargs):
        result = subprocess.run(command + list(arguments), capture_output=True, text=True, **kwargs)
        if result.returncode:
            raise RuntimeError(f"Compose {' '.join(arguments)} mislukt:\n{result.stderr[-6000:]}\n{result.stdout[-3000:]}")
        return result.stdout.strip()

    def request(host, path, jar=None, data=None, upload=None):
        call = ['curl', '--silent', '--show-error', '--insecure', '--noproxy', '*', '--max-time', '10',
            '--resolve', f'{host}:{port}:127.0.0.1', '--write-out', '\n%{http_code}',
            '--header', f'Origin: https://{host}:{port}', f'https://{host}:{port}{path}']
        if jar:
            call += ['--cookie', str(jar), '--cookie-jar', str(jar)]
        if data is not None:
            call += ['--header', 'Content-Type: application/json', '--data-binary', '@-']
        if upload:
            call += ['--form', f'bestand=@{upload};type=application/pdf']
        response = subprocess.run(call, input=json.dumps(data) if data is not None else None, text=True, capture_output=True, check=True)
        body, code = response.stdout.rsplit('\n', 1)
        return int(code), body

    try:
        compose('config', '--quiet')
        print('Start: twee tijdelijke bedrijven en eigen beheerders initialiseren.', flush=True)
        password = secrets.token_urlsafe(24)
        for company in companies:
            environment = os.environ.copy()
            environment.update(ServiceProcesgids__LocalUser__BootstrapEnabled='true', ServiceProcesgids__LocalUser__Password=password)
            compose('run', '--rm', '--no-deps', '-e', 'ServiceProcesgids__LocalUser__BootstrapEnabled', '-e', 'ServiceProcesgids__LocalUser__Password',
                'app-' + company['slug'], '--bootstrap-local-admin', env=environment)
        compose('up', '-d', '--wait', '--wait-timeout', '120')
        print('Containers gezond; HTTPS, frontend en gescheiden logins controleren.', flush=True)
        port = int(compose('port', 'proxy', '443').rsplit(':', 1)[1])
        for host in ('alpha.localhost', 'beta.localhost'):
            deadline = time.monotonic() + 45
            while True:
                try:
                    if request(host, '/api/health/ready')[0] == 200:
                        break
                except subprocess.CalledProcessError:
                    pass
                if time.monotonic() > deadline:
                    raise RuntimeError(f'{host} niet gezond via HTTPS.')
                time.sleep(1)
            code, html = request(host, '/')
            assert code == 200 and 'id="root"' in html, f'Frontend ontbreekt bij {host}.'
        a, b = state / 'alpha.cookies', state / 'beta.cookies'
        for host, jar in (('alpha.localhost', a), ('beta.localhost', b)):
            assert request(host, '/api/auth/login', jar, {'gebruikersnaam': 'Admin', 'wachtwoord': password})[0] == 200
            assert request(host, '/api/me', jar)[0] == 200
        password = ''
        forged = state / 'cross-company.cookies'
        forged.write_text(a.read_text().replace('alpha.localhost', 'beta.localhost'))
        assert request('beta.localhost', '/api/me', forged)[0] == 401, 'Cookie van A werkt bij B!'
        print('HTTPS/frontend/logins goed; cookie van A wordt door B geweigerd.', flush=True)
        process_id = 'isolation-' + uuid.uuid4().hex
        process = {'id': process_id, 'hoofdproces': 'Generiek testproces', 'detailproces': 'Alleen zichtbaar bij Alpha',
            'versie': '1.0', 'status': 'concept', 'laatsteWijziging': '2026-09-08', 'revision': None, 'bron': None,
            'lanes': [{'id': 'medewerker', 'naam': 'Medewerker', 'kleur': '#2563eb'}], 'secties': [],
            'stappen': [{'id': 'start', 'nummer': '1', 'laneId': 'medewerker', 'type': 'actie', 'activiteit': 'Controleer de aanvraag'}]}
        code, body = request('alpha.localhost', '/api/processes/', a, process)
        assert code == 201, f'Proces aanmaken: HTTP {code}: {body[:400]}'
        assert request('alpha.localhost', '/api/workspace/processes/' + process_id, a)[0] == 200
        assert request('beta.localhost', '/api/workspace/processes/' + process_id, b)[0] == 404, 'Proces van A is zichtbaar bij B!'
        pdf = state / 'synthetic.pdf'
        synthetic_pdf(pdf)
        code, body = request('alpha.localhost', '/api/import/pdf', a, upload=pdf)
        assert code == 202, f'PDF-upload: HTTP {code}: {body[:400]}'
        job = json.loads(body)
        file_id = job['bronBestandId']
        assert file_id, 'Upload heeft geen bronbestand-id.'
        assert request('alpha.localhost', '/api/files/' + file_id, a)[0] == 200
        assert request('beta.localhost', '/api/files/' + file_id, b)[0] == 404, 'Bestand van A is zichtbaar bij B!'
        assert request('alpha.localhost', '/api/files/' + file_id)[0] == 401
        beta_container = compose('ps', '-q', 'app-beta')
        beta_ip = subprocess.run(['docker', 'inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', beta_container],
            check=True, capture_output=True, text=True).stdout.strip()
        assert beta_ip.startswith('172.28.242.'), 'Onverwacht testnetwerk; netwerkprobe afgebroken.'
        network_probe = subprocess.run(command + ['exec', '-T', 'app-alpha', 'curl', '--silent', '--max-time', '3', f'http://{beta_ip}:8080/api/health'], capture_output=True)
        assert network_probe.returncode != 0, 'App A kan direct naar het private netwerk van app B!'
        spoof_status = compose('exec', '-T', 'app-alpha', 'curl', '--silent', '--output', '/dev/null', '--write-out', '%{http_code}',
            '--header', 'X-Forwarded-Proto: https', 'http://127.0.0.1:8080/api/me')
        assert spoof_status in ('400', '403'), 'Direct HTTP met vervalste proxyheader werd geaccepteerd.'
        for slug in ('alpha', 'beta'):
            compose('exec', '-T', 'app-' + slug, 'sh', '-c', 'grep -q encryptedSecret /app/App_Data/data-protection-keys/*.xml')
        print('Isolatie groen; volledige gestopte App_Data-snapshot naar nieuw leeg testvolume herstellen.', flush=True)
        compose('stop', 'app-alpha')
        assert request('beta.localhost', '/api/health/ready')[0] == 200
        alpha_container = compose('ps', '-a', '-q', 'app-alpha')
        exact_image = subprocess.run(['docker', 'inspect', '--format', '{{.Image}}', alpha_container],
            check=True, capture_output=True, text=True).stdout.strip()
        assert exact_image.startswith('sha256:'), 'Ontbrekende exacte herstelimage.'
        backup = state / 'backup'
        backup.mkdir(mode=0o700)
        (backup / 'image-id.txt').write_text(exact_image + '\n')
        shutil.copytree(state / 'secrets' / 'alpha', backup / 'secrets')

        def volume_tar(volume, archive_name, restore=False):
            assert volume.startswith(project + '-'), 'Alleen eigen testvolumes zijn toegestaan.'
            mounts = ['--mount', f'type=volume,src={volume},dst=/data' + ('' if restore else ',readonly'),
                '--mount', f'type=bind,src={backup},dst=/backup' + (',readonly' if restore else '')]
            subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0',
                '--entrypoint', 'tar', *mounts, exact_image, '-xpf' if restore else '-cpf',
                '/backup/' + archive_name, '-C', '/data', *([] if restore else ['.'])], check=True, capture_output=True)

        volume_tar(document['volumes']['data-alpha']['name'], 'App_Data.tar')
        before_restore = archive_manifest(backup / 'App_Data.tar')
        restored_volume = project + '-restored-alpha'
        assert subprocess.run(['docker', 'volume', 'inspect', restored_volume], capture_output=True).returncode != 0
        document['volumes']['restored-alpha'] = {'name': restored_volume}
        # Register the new test volume in the cleanup manifest before creating it.
        provision.atomic_json(compose_file, document)
        subprocess.run(['docker', 'volume', 'create', restored_volume], check=True, capture_output=True)
        volume_tar(restored_volume, 'App_Data.tar', restore=True)
        volume_tar(restored_volume, 'Restored.tar')
        assert before_restore == archive_manifest(backup / 'Restored.tar'), 'Herstel wijkt af in bestanden, bytes of eigenaar.'
        document['services']['app-alpha']['volumes'] = ['restored-alpha:/app/App_Data']
        document['secrets']['cert-alpha']['file'] = str(backup / 'secrets' / 'certificate.pem')
        document['secrets']['key-alpha']['file'] = str(backup / 'secrets' / 'private-key.pem')
        provision.atomic_json(compose_file, document)
        compose('up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'app-alpha')
        assert request('alpha.localhost', '/api/me', a)[0] == 200, 'Bestaande cookie werkt niet na herstel van de keyring.'
        assert request('alpha.localhost', '/api/workspace/processes/' + process_id, a)[0] == 200
        assert request('alpha.localhost', '/api/files/' + file_id, a)[0] == 200
        assert request('beta.localhost', '/api/me', b)[0] == 200
        print('PASS: twee HTTPS-bedrijven gezond; eigen logins; A-cookie geweigerd door B; proces en PDF van A onzichtbaar bij B; bestanden vereisen login; private netwerken gescheiden; proxyheader-spoof geweigerd; keyrings versleuteld; volledige App_Data en sleutels hersteld naar nieuw volume met identieke bytes/eigenaar, bestaande login/proces/PDF bruikbaar en bedrijf B beschikbaar.')
    except Exception:
        print(compose('logs', '--tail', '60'))
        raise
    finally:
        # Only this invocation's UUID project and explicitly prefixed test volumes.
        assert document['name'] == project and all(v['name'].startswith(project + '-') for v in document['volumes'].values())
        try:
            compose('down', '--volumes', '--remove-orphans')
        finally:
            assert state.name.startswith(project + '-')
            temporary.cleanup()


if __name__ == '__main__':
    main()
