export const meta = {
  name: 'lane',
  description: 'One claimed lane to ready-to-land: build, review, fixes, then the explorative end-to-end test and CI side by side; landing stays with the head.',
  whenToUse: 'After `aco start <item>` in a repository that coordinates with aco, to take its claimed lane to ready-to-land. Required args: item (GitHub issue number), worktree, branch, contract (the ruled sentences reviewers judge against), e2e (what the tester drives), scratch (a directory for briefs and evidence). Start with build (a builder brief) for a new lane, or with pr and tip to continue one. Optional args, routing, budgets and results: plugins/atelier/workflows/lane.md.',
  phases: [
    { title: 'Build' },
    { title: 'Sync' },
    { title: 'Review' },
    { title: 'Fix' },
    { title: 'Test and CI' },
  ],
}
