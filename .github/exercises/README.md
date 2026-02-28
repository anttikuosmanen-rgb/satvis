# GitHub Actions Debugging Exercises

These exercises provide hands-on practice debugging common GitHub Actions issues. Each exercise contains a broken workflow file that you need to fix.

## How to Use These Exercises

1. **Read the scenario** - Each exercise describes a problem and expected behavior
2. **Examine the broken workflow** - Open the `exercise-X-*-broken.yml` file
3. **Try to identify the issues** - Use the hints if you get stuck
4. **Check your solution** - Compare with `exercise-X-*-solution.yml`
5. **Test locally (optional)** - Use `act` to validate your fix

## Recommended Approach

1. **Don't look at solutions first** - Challenge yourself to find the bugs
2. **Use the tools** - Run `actionlint` on broken files to catch syntax errors
3. **Read error messages carefully** - They often point directly to the issue
4. **Understand WHY it's wrong** - The solution files include explanations

---

## Exercise 1: Syntax Errors

**Difficulty:** Beginner

**Scenario:** A new team member wrote their first workflow but it won't run. GitHub shows a syntax error but doesn't specify exactly what's wrong.

**Skills Tested:**
- YAML indentation rules
- Required workflow fields
- Action naming conventions

**Files:**
- Broken: `exercise-1-syntax-broken.yml`
- Solution: `exercise-1-syntax-solution.yml`

**Expected Errors:**
- Workflow won't parse
- "Invalid workflow file" message

---

## Exercise 2: Context and Expression Errors

**Difficulty:** Beginner-Intermediate

**Scenario:** A workflow is supposed to run different steps based on the event type and branch, but the conditions aren't working as expected. Some steps run when they shouldn't, and others never run.

**Skills Tested:**
- Context variable usage (github.*, env.*, etc.)
- Expression syntax
- Conditional execution

**Files:**
- Broken: `exercise-2-context-broken.yml`
- Solution: `exercise-2-context-solution.yml`

**Expected Errors:**
- Steps running in wrong conditions
- Expression evaluation errors
- "Unexpected value" warnings

---

## Exercise 3: Matrix Strategy Failures

**Difficulty:** Intermediate

**Scenario:** A Node.js project tests across multiple versions. The workflow runs but fails inconsistently - sometimes Node 20 works but Node 22 fails, or vice versa. The team can't figure out why.

**Skills Tested:**
- Matrix strategy debugging
- Version compatibility issues
- Identifying failing matrix combinations

**Files:**
- Broken: `exercise-3-matrix-broken.yml`
- Solution: `exercise-3-matrix-solution.yml`

**Expected Errors:**
- Partial matrix failures
- Version-specific test failures

---

## Exercise 4: Job Dependencies and Artifacts

**Difficulty:** Intermediate

**Scenario:** A CI/CD pipeline has separate build and deploy jobs. The build job succeeds and uploads an artifact, but the deploy job can't find the artifact and fails. The workflow used to work but broke after an upgrade.

**Skills Tested:**
- Job dependencies (needs)
- Artifact upload/download
- Version migration issues

**Files:**
- Broken: `exercise-4-conditional-broken.yml`
- Solution: `exercise-4-conditional-solution.yml`

**Expected Errors:**
- "Artifact not found" error
- Deploy job fails or skips unexpectedly
- Job ordering issues

---

## Exercise 5: Secrets and Permissions

**Difficulty:** Advanced

**Scenario:** A deployment workflow works fine when a maintainer runs it, but fails when triggered by a PR from a fork. The team also notices the workflow sometimes can't push to the container registry even on the main branch.

**Skills Tested:**
- Secret availability in different contexts
- GITHUB_TOKEN permissions
- Fork PR security model
- Environment protection

**Files:**
- Broken: `exercise-5-secrets-broken.yml`
- Solution: `exercise-5-secrets-solution.yml`

**Expected Errors:**
- "Secret not found" (when run from fork)
- "403 Forbidden" on registry push
- Permission denied errors

---

## Exercise 6: Matrix Include/Exclude

**Difficulty:** Intermediate

**Scenario:** A workflow tests across multiple OS and Node.js versions. The team wants to skip all Windows jobs, add an experimental flag to Node 22, and exclude a specific problematic combination. But the matrix isn't behaving as expected.

**Skills Tested:**
- Matrix `exclude` exact matching behavior
- Matrix `include` property addition rules
- YAML duplicate key behavior
- Handling undefined matrix variables

**Files:**
- Broken: `exercise-6-matrix-exclude-broken.yml`
- Solution: `exercise-6-matrix-exclude-solution.yml`

**Expected Errors:**
- Windows jobs still running despite exclude
- Experimental flag not applied correctly
- Type mismatch (string vs integer) in exclude

---

## Tools for Debugging

### actionlint (Recommended)

```bash
# Install
brew install actionlint  # macOS
go install github.com/rhysd/actionlint/cmd/actionlint@latest  # Go

# Check a specific file
actionlint .github/exercises/exercise-1-syntax-broken.yml

# Check all exercises
actionlint .github/exercises/*.yml
```

### act (Local Testing)

```bash
# Test a workflow locally
act push -W .github/exercises/exercise-1-syntax-broken.yml

# With verbose output
act push -v -W .github/exercises/exercise-1-syntax-broken.yml
```

### GitHub UI

Copy an exercise to `.github/workflows/` and push to see actual GitHub error messages. Remember to delete it afterward!

---

## Common Gotchas Reference

| Issue | Symptom | Common Cause |
|-------|---------|--------------|
| YAML syntax error | Workflow won't parse | Wrong indentation, missing colon |
| Action not found | "Unable to resolve action" | Typo in action name, wrong version |
| Secret is empty | Step fails silently | Secret name mismatch, fork PR |
| Condition never true | Step always skipped | Wrong context variable, missing quotes |
| Artifact not found | Download fails | Name mismatch, wrong artifact version |
| Permission denied | API call fails | Missing permissions block |
| Matrix job fails | One combination fails | Version-specific code issues |
| Exclude not working | Jobs still run | Exclude needs exact match of ALL properties |
| Duplicate YAML key | First value ignored | Can only have one `exclude:` or `include:` block |
| Matrix var undefined | Empty or error | Not all combinations have the variable defined |

---

## Validation Checklist

After fixing a workflow, verify:

- [ ] `actionlint` reports no errors
- [ ] Indentation is consistent (2 spaces)
- [ ] All required fields are present (`on:`, `jobs:`, `runs-on:`, `steps:`)
- [ ] Action versions are valid (`@v4`, not `@latest`)
- [ ] Expressions use correct syntax (`${{ }}`)
- [ ] Secrets are spelled correctly
- [ ] Conditions use proper comparison operators

---

## Next Steps

After completing these exercises:

1. **Review the annotated workflows** in `.github/workflows/` for real-world patterns
2. **Read the guides:**
   - [ACTIONS_GUIDE.md](../ACTIONS_GUIDE.md) - Core concepts
   - [ACT_LOCAL_TESTING.md](../ACT_LOCAL_TESTING.md) - Local debugging
   - [ADVANCED_ACTIONS.md](../ADVANCED_ACTIONS.md) - Advanced topics
3. **Create your own workflow** - Practice makes perfect!
