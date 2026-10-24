# Hosting and domain configuration

The website is hosted by GitHub Pages from this repository. Cloudflare manages
the registered domain and its authoritative DNS. The Unity game is kept in a
separate private repository.

## Deployment

Push to `main` to run `.github/workflows/pages.yml`. It installs pinned npm
packages, runs the swarm tests, bundles the renderer, and deploys only `dist/`.
The workflow can also be dispatched manually in GitHub Actions.

GitHub Pages settings use **GitHub Actions** as the source and **hexdrones.ai** as
the custom domain. An Actions deployment does not require a `CNAME` file.

## DNS

Records are DNS-only (Cloudflare proxy disabled) with a 300-second TTL.

| Type | Name | Content |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| AAAA | @ | 2606:50c0:8000::153 |
| AAAA | @ | 2606:50c0:8001::153 |
| AAAA | @ | 2606:50c0:8002::153 |
| AAAA | @ | 2606:50c0:8003::153 |
| CNAME | www | stephenlucerne.github.io |

GitHub Pages redirects `www.hexdrones.ai` to `hexdrones.ai` because the apex is
configured as the canonical custom domain. No Cloudflare redirect rule is needed.

## HTTPS and verification

GitHub provisions the domain certificate. Enable **Enforce HTTPS** in repository
Pages settings once the certificate is available. Verify HTTPS for both hostnames
and the redirect after DNS or domain-setting changes.

```sh
dig hexdrones.ai A +short
dig hexdrones.ai AAAA +short
dig www.hexdrones.ai CNAME +short
curl -I https://hexdrones.ai/
curl -I https://www.hexdrones.ai/
```

The site should respond over HTTPS with a valid certificate; `www` should redirect
to the apex. Do not disable certificate validation to work around provisioning.

GitHub reference: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
