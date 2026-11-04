"""Configuration/isolation tests; no Docker daemon, service or real data is used."""
import json
from pathlib import Path
import tempfile
import unittest

import provision


def fake_certificate(directory, slug):
    directory.mkdir(parents=True)
    (directory / 'certificate.pem').write_text('fixture certificate ' + slug)
    (directory / 'private-key.pem').write_text('fixture private key ' + slug)


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.state = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def add(self, slug, domain):
        provision.add_company(self.state, slug, domain, fake_certificate)

    def test_two_companies_have_separate_data_keys_networks_and_proxy_trust(self):
        self.add('organisatie-a', 'a.example.com')
        self.add('organisatie-b', 'b.example.com')
        document = json.loads((self.state / 'compose.generated.json').read_text())
        a, b = (document['services']['app-' + slug] for slug in ('organisatie-a', 'organisatie-b'))
        self.assertNotEqual(a['volumes'], b['volumes'])
        self.assertTrue(set(a['networks']).isdisjoint(b['networks']))
        self.assertNotEqual(a['secrets'], b['secrets'])
        self.assertEqual(a['environment']['ServiceProcesgids__ReverseProxy__KnownProxies__0'], '172.28.1.2')
        self.assertEqual(b['environment']['ServiceProcesgids__ReverseProxy__KnownProxies__0'], '172.28.2.2')
        self.assertEqual(a['networks']['org-organisatie-a']['ipv4_address'], '172.28.1.3')
        self.assertEqual(b['networks']['org-organisatie-b']['ipv4_address'], '172.28.2.3')
        for app in (a, b):
            self.assertNotIn('ports', app)
            self.assertEqual(app['environment']['Urls'], 'http://+:8080')
            self.assertTrue(app['read_only'])
            self.assertEqual(app['environment']['ServiceProcesgids__Ai__EnableLocalChatGptOAuth'], 'false')
            self.assertNotIn('ServiceProcesgids__LocalUser__Password', app['environment'])
        caddy = (self.state / 'Caddyfile').read_text()
        self.assertIn('a.example.com {\n  encode zstd gzip\n  reverse_proxy app-organisatie-a:8080', caddy)
        self.assertIn('b.example.com {\n  encode zstd gzip\n  reverse_proxy app-organisatie-b:8080', caddy)

    def test_reprovision_is_refused_without_touching_existing_keys(self):
        self.add('alpha', 'alpha.example.com')
        before = {p.relative_to(self.state): p.read_bytes() for p in self.state.rglob('*') if p.is_file()}
        with self.assertRaises(ValueError):
            self.add('alpha', 'new.example.com')
        after = {p.relative_to(self.state): p.read_bytes() for p in self.state.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_duplicate_domain_is_refused(self):
        self.add('alpha', 'alpha.example.com')
        with self.assertRaises(ValueError):
            self.add('beta', 'alpha.example.com')
        self.assertFalse((self.state / 'secrets' / 'beta').exists())

    def test_slug_path_and_caddy_injection_are_rejected(self):
        for slug in ('../alpha', '/tmp/alpha', 'ALPHA', 'alpha;whoami', 'a\n}', 'a--b', 'a_' , 'a' * 33):
            with self.subTest(slug=slug), self.assertRaises(ValueError):
                self.add(slug, 'alpha.example.com')
        for domain in ('https://a.example.com', 'a.example.com:8080', '*.example.com', 'localhost', 'a.example.com\n{file_server}', '../example.com'):
            with self.subTest(domain=domain), self.assertRaises(ValueError):
                self.add('alpha', domain)
        self.assertFalse((self.state / 'organizations.json').exists())

    def test_failed_certificate_generation_does_not_register_company(self):
        def fail(*args):
            raise OSError('fixture failure')
        with self.assertRaises(OSError):
            provision.add_company(self.state, 'alpha', 'a.example.com', fail)
        self.assertFalse((self.state / 'organizations.json').exists())

    def test_network_allocations_remain_stable_and_registry_is_checked(self):
        self.add('alpha', 'a.example.com')
        self.add('beta', 'b.example.com')
        companies = provision.load_companies(self.state)
        provision.render(self.state, companies)
        self.assertEqual([c['network'] for c in companies], [1, 2])
        companies[1]['network'] = 1
        (self.state / 'organizations.json').write_text(json.dumps(companies))
        with self.assertRaises(ValueError):
            provision.load_companies(self.state)


if __name__ == '__main__':
    unittest.main()
