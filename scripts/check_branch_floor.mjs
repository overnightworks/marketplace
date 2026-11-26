// Holds a branch-coverage floor over the files of an lcov report: usage `node scripts/check_branch_floor.mjs <lcov> <percent> <path>`,
// where <path> is a file or directory (relative to the working directory) whose files the floor covers.
// A floor only rises: raise <percent> to the printed measurement.
import fs from 'node:fs'
import path from 'node:path'

const [report, floor, covered] = process.argv.slice(2)
const root = path.resolve(covered)
const totals = { found: 0, hit: 0 }
for (const record of fs.readFileSync(report, 'utf8').split(/^SF:/m).slice(1)) {
  const file = record.split('\n')[0]
  if (file !== root && !file.startsWith(root + path.sep)) continue
  totals.found += Number(/^BRF:(\d+)$/m.exec(record)[1])
  totals.hit += Number(/^BRH:(\d+)$/m.exec(record)[1])
}
if (totals.found === 0) {
  console.error(`${report} holds no branches of ${covered}`)
  process.exit(1)
}
const percent = (100 * totals.hit) / totals.found
console.log(`${covered}: ${totals.hit} of ${totals.found} branches, ${percent.toFixed(2)} % (floor ${floor} %)`)
if (percent < Number(floor)) {
  console.error(`${covered} is below its branch-coverage floor of ${floor} %`)
  process.exit(1)
}
