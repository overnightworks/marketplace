// Holds a branch-coverage floor over the files of an lcov report: usage `node scripts/check_branch_floor.mjs <lcov> <percent> <path>`,
// where <path> is a substring of the report's file paths. A floor only rises: raise <percent> to the printed measurement.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

/** The branches found and hit over the report's files whose path contains `path`. */
export function branchTotals(lcov, path) {
  const totals = { found: 0, hit: 0 }
  for (const record of lcov.split(/^SF:/m).slice(1)) {
    if (!record.split('\n')[0].includes(path)) continue
    totals.found += Number(/^BRF:(\d+)$/m.exec(record)[1])
    totals.hit += Number(/^BRH:(\d+)$/m.exec(record)[1])
  }
  return totals
}

export function main(argv) {
  const [report, floor, path] = argv
  const { found, hit } = branchTotals(fs.readFileSync(report, 'utf8'), path)
  if (found === 0) {
    console.error(`${report} holds no branches of ${path}`)
    return void (process.exitCode = 1)
  }
  const percent = (100 * hit) / found
  console.log(`${path}: ${hit} of ${found} branches, ${percent.toFixed(2)} % (floor ${floor} %)`)
  if (percent < Number(floor)) {
    console.error(`${path} is below its branch-coverage floor of ${floor} %`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
