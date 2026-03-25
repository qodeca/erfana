# Troubleshooting and rollback procedures

## Build size too large (>300 MB)

Check electron-builder.yml excludes:
```yaml
files:
  - "!release/**"
  - "!coverage/**"
  - "!tests/**"
```

## Tests failing

```bash
# Run specific test suite for debugging
npm run test:renderer
npm run test:main
npm run test:preload
```

## TypeScript errors

```bash
# Check specific config
npm run typecheck:node
npm run typecheck:web
```

## Rollback procedures

### If build fails mid-process

1. Check error messages in terminal
2. Fix the issue (usually in source code)
3. Clean the failed build: `rm -rf release/{version}/`
4. Restart from Phase 1 (quality gates)

### If critical bug found post-release

1. **Do NOT delete the release folder** (keep for reference)
2. Create hotfix branch: `git checkout -b hotfix/{version}`
3. Fix the bug
4. Bump patch version in package.json
5. Run full release process for new version
6. If git tag was pushed:
   ```bash
   # Delete remote tag (use with caution)
   git push --delete origin v{version}
   # Delete local tag
   git tag -d v{version}
   ```

### If GitHub release was created

1. Go to GitHub Releases page
2. Edit the release and mark as "Pre-release" or delete draft
3. Add note explaining the issue
4. Create new release with fixed version

### Recovery checklist

- [ ] Identify what went wrong
- [ ] Document the issue for future reference
- [ ] Clean up any partial artifacts
- [ ] Communicate with users if release was distributed
- [ ] Create new release with fix
