// import { fetch } from "bun"
(async () => {
  // @ts-ignore
  // const { DateTime } = await import('https://unpkg.com/luxon@3.5.0/build/es6/luxon.js');
  // const now = DateTime.now();
  // console.log(now.toISO());
  const response = await fetch("https://www.linkedin.com/in/mikeodnis/")
  console.log(response)
})();