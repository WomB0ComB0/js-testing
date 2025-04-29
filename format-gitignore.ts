import { $, write } from "bun";

if (require.main === module) {
  (async () => {
    try {
      const filePath = `${process.cwd()}/.gitignore`;
      console.log(filePath);
      const content = (await $`cat ${filePath}`.text().then(text => text.trim()
        .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
        .replace(/[^\x00-\x7F]/g, "")
        .replace(/,/g, " ")
        .replace(/:/g, " ")
        .replace(/=/g, " ")
        .replace(/;/g, " ")))

      if (!content) throw new Error("File not found");

      const book: Set<string> = new Set();
      for (const line of content.split("\n")) {
        if (line.includes("#")) {
          if (line.startsWith("#")) continue;
          const [key, value] = line.split("#");
          if (key.trim().length > 0) book.add(key);
          if (value.trim().length > 0) book.add(value);
        };
        if (line.trim().length > 0) book.add(line);
      }
      await write(filePath, Array.from(book.values()).join("\n"));
    } catch (error) {
      console.error("An error occurred:", error);
      throw new Error(`${error instanceof Error ? error.message : error}`);
    }
  })();
  process.exit(0);
}