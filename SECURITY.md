# Security Notice

## Token Handling
- GitHub tokens are stored ONLY in environment variables
- NEVER hardcode tokens in source code
- `.env` file is gitignored and should never be committed
- If you suspect token leakage, revoke immediately at: https://github.com/settings/tokens

## Environment Variables Required
- `GITHUB_TOKEN` - GitHub personal access token
- `JWT_SECRET` - Secret for JWT signing
- `PORT` - Server port (default: 3000)
