import { native } from "./cli";
process.exitCode = await native([
  "d1",
  "migrations",
  "apply",
  "charoo",
  ".",
  ...process.argv.slice(2).filter((arg) => arg !== "--"),
]);
