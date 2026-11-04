#!/usr/bin/env python3
"""Generate isolated company deployments. Requires Python 3.10+, OpenSSL, Docker Compose.

Generation never contacts a customer or deploys anything. Docker is invoked only
by the explicit bootstrap command, after the operator has built the image.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "service-procesgids:local"
CADDY_IMAGE = "caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
SLUG = re.compile(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z")
DOMAIN = re.compile(r"(?=.{4,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")


def validate_slug(slug: str) -> str:
    if len(slug) > 32 or not SLUG.fullmatch(slug):
        raise ValueError("Bedrijfscode: 1-32 kleine letters/cijfers met enkele koppeltekens; begin met een letter.")
    return slug


def validate_domain(domain: str) -> str:
    if not DOMAIN.fullmatch(domain):
        raise ValueError("Geef een volledige DNS-hostnaam zonder protocol, pad, wildcard of poort.")
    return domain


def atomic_json(path: Path, value: object) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as f:
        json.dump(value, f, indent=2)
        f.write("\n")
        temporary = Path(f.name)
    temporary.replace(path)


def load_companies(state: Path) -> list[dict]:
    registry = state / "organizations.json"
    companies = json.loads(registry.read_text()) if registry.exists() else []
    slugs, domains, networks = set(), set(), set()
    for company in companies:
        slug = validate_slug(company["slug"])
        domain = validate_domain(company["domain"])
        network = company["network"]
        if isinstance(network, bool) or not isinstance(network, int) or not 1 <= network <= 254:
            raise ValueError("Ongeldig netwerknummer in organisatiesregister.")
        if slug in slugs or domain in domains or network in networks:
            raise ValueError("Dubbele bedrijfscode, hostnaam of netwerknummer.")
        slugs.add(slug)
        domains.add(domain)
        networks.add(network)
    return companies


def compose_document(state: Path, companies: list[dict], repo: Path = ROOT) -> dict:
    proxy = {
        "image": CADDY_IMAGE, "restart": "unless-stopped",
        "ports": ["80:80", "443:443", "443:443/udp"],
        "volumes": [f"{state / 'Caddyfile'}:/etc/caddy/Caddyfile:ro", "caddy-data:/data", "caddy-config:/config"],
        "networks": {}, "security_opt": ["no-new-privileges:true"],
    }
    result = {"name": "spg-hosting", "services": {"proxy": proxy}, "volumes": {"caddy-data": {}, "caddy-config": {}}, "networks": {}, "secrets": {}}
    for company in companies:
        slug, domain, number = company["slug"], company["domain"], company["network"]
        network, volume = f"org-{slug}", f"data-{slug}"
        proxy_ip = f"172.28.{number}.2"
        # Each app sees only its own bridge and proxy; no shared app network.
        # The bridge permits outbound HTTPS for Entra, mail and configured AI.
        result["networks"][network] = {"driver": "bridge", "ipam": {"config": [{"subnet": f"172.28.{number}.0/24"}]}}
        proxy["networks"][network] = {"ipv4_address": proxy_ip}
        result["volumes"][volume] = {"name": f"spg-{slug}-data"}
        cert, key = f"cert-{slug}", f"key-{slug}"
        result["secrets"][cert] = {"file": str(state / "secrets" / slug / "certificate.pem")}
        result["secrets"][key] = {"file": str(state / "secrets" / slug / "private-key.pem")}
        result["services"][f"app-{slug}"] = {
            "image": IMAGE, "build": {"context": str(repo), "dockerfile": "Dockerfile"},
            "restart": "unless-stopped", "init": True, "read_only": True,
            "security_opt": ["no-new-privileges:true"], "cap_drop": ["ALL"],
            "tmpfs": ["/tmp:rw,noexec,nosuid,size=128m"],
            "pids_limit": 256, "mem_limit": "1g", "cpus": 2,
            "environment": {
                "ASPNETCORE_ENVIRONMENT": "Production", "ASPNETCORE_URLS": "http://+:8080", "Urls": "http://+:8080",
                "AllowedHosts": f"{domain};localhost;127.0.0.1",
                "ServiceProcesgids__AuthMode": "local", "ServiceProcesgids__Storage": "local",
                "ServiceProcesgids__Online": "true", "ServiceProcesgids__Runtime__Mode": "standard",
                "ServiceProcesgids__Runtime__DataSource": "database",
                "ServiceProcesgids__Ai__EnableLocalChatGptOAuth": "false",
                "ServiceProcesgids__ReverseProxy__KnownProxies__0": proxy_ip,
                "ServiceProcesgids__DataProtection__CertificatePath": "/run/secrets/data_protection_certificate",
                "ServiceProcesgids__DataProtection__PrivateKeyPath": "/run/secrets/data_protection_private_key",
            },
            "volumes": [f"{volume}:/app/App_Data"], "networks": {network: {"ipv4_address": f"172.28.{number}.3"}},
            "secrets": [{"source": cert, "target": "data_protection_certificate"}, {"source": key, "target": "data_protection_private_key"}],
            "logging": {"driver": "json-file", "options": {"max-size": "10m", "max-file": "3"}},
        }
    return result


def render(state: Path, companies: list[dict]) -> None:
    if not companies:
        raise ValueError("Voeg eerst ten minste een organisatie toe.")
    atomic_json(state / "compose.generated.json", compose_document(state, companies))
    blocks = []
    for company in companies:
        # Values were validated when loading/adding. No arbitrary Caddy directives.
        blocks.append(f"{company['domain']} {{\n  encode zstd gzip\n  reverse_proxy app-{company['slug']}:8080\n  header {{\n    X-Content-Type-Options nosniff\n    Referrer-Policy strict-origin-when-cross-origin\n    -Server\n  }}\n}}\n")
    (state / "Caddyfile").write_text("\n".join(blocks), encoding="utf-8")


def create_certificate(directory: Path, slug: str) -> None:
    if not shutil.which("openssl"):
        raise ValueError("OpenSSL ontbreekt. Installeer OpenSSL op de Linux-host voordat u een bedrijf toevoegt.")
    directory.mkdir(parents=True, mode=0o700)
    try:
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "3650", "-subj", f"/CN=spg-{slug}-data-protection",
            "-keyout", str(directory / "private-key.pem"), "-out", str(directory / "certificate.pem")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # The secret files are readable by the non-root app through Docker's bind
        # mount. Their 0700 host parent still denies access to other host users.
        (directory / "private-key.pem").chmod(0o644)
        (directory / "certificate.pem").chmod(0o644)
    except Exception:
        for name in ("private-key.pem", "certificate.pem"):
            (directory / name).unlink(missing_ok=True)
        directory.rmdir()
        raise


def add_company(state: Path, slug: str, domain: str, certificate_factory=create_certificate) -> None:
    validate_slug(slug)
    validate_domain(domain)
    companies = load_companies(state)
    if any(c["slug"] == slug or c["domain"] == domain for c in companies):
        raise ValueError("Bedrijfscode of hostnaam bestaat al; bestaande data/configuratie blijven behouden.")
    used = {c["network"] for c in companies}
    available = next((n for n in range(1, 255) if n not in used), None)
    if available is None:
        raise ValueError("Deze hostconfiguratie heeft geen vrij netwerknummer meer.")
    certificate_factory(state / "secrets" / slug, slug)
    companies.append({"slug": slug, "domain": domain, "network": available})
    atomic_json(state / "organizations.json", companies)
    render(state, companies)


def bootstrap(state: Path, slug: str) -> None:
    validate_slug(slug)
    if not any(c["slug"] == slug for c in load_companies(state)):
        raise ValueError("Onbekende organisatie.")
    password = getpass.getpass("Eerste Admin-wachtwoord (minimaal 12 tekens): ")
    if len(password) < 12 or password != getpass.getpass("Herhaal wachtwoord: "):
        raise ValueError("Wachtwoord te kort of bevestiging wijkt af.")
    environment = os.environ.copy()
    environment["ServiceProcesgids__LocalUser__BootstrapEnabled"] = "true"
    environment["ServiceProcesgids__LocalUser__Password"] = password
    try:
        # Values stay out of command arguments, generated files and normal service
        # configuration. The one-off container is removed when bootstrap exits.
        subprocess.run(["docker", "compose", "-f", str(state / "compose.generated.json"), "run", "--rm", "--no-deps",
            "-e", "ServiceProcesgids__LocalUser__BootstrapEnabled", "-e", "ServiceProcesgids__LocalUser__Password",
            f"app-{slug}", "--bootstrap-local-admin"], env=environment, check=True)
    finally:
        environment.pop("ServiceProcesgids__LocalUser__BootstrapEnabled", None)
        environment.pop("ServiceProcesgids__LocalUser__Password", None)
        password = ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=ROOT / "hosting" / ".state")
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("add")
    add.add_argument("--slug", required=True)
    add.add_argument("--domain", required=True)
    commands.add_parser("render")
    commands.add_parser("list")
    first = commands.add_parser("bootstrap")
    first.add_argument("--slug", required=True)
    args = parser.parse_args()
    state = args.state_dir.resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    try:
        if args.command == "add":
            add_company(state, args.slug, args.domain)
        elif args.command == "render":
            render(state, load_companies(state))
        elif args.command == "bootstrap":
            bootstrap(state, args.slug)
        else:
            print(json.dumps(load_companies(state), indent=2))
        if args.command in ("add", "render"):
            print(f"Configuratie gemaakt: {state / 'compose.generated.json'} (nog niet uitgerold).")
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
