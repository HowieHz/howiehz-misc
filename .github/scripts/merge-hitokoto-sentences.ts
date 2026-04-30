import { once } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";

interface SourceSentenceRecord {
  hitokoto?: unknown;
  from?: unknown;
  from_who?: unknown;
}

interface ReducedSentenceRecord {
  hitokoto: string;
  from: string;
  from_who: string | null;
}

interface CliOptions {
  inputDirectoryPath: string;
  outputFilePath: string;
}

const defaultInputDirectoryPath = path.join("tmp", "sentences-bundle", "sentences");
const defaultOutputFilePath = path.join("tmp", "hitokoto-sentences.json");
const chunkSize = 64 * 1024;

const appendGitHubOutput = async (name: string, value: string): Promise<void> => {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  await fsPromises.appendFile(outputPath, `${name}=${value}\n`, "utf8");
};

const printHelp = (): void => {
  console.log(`Usage: node --experimental-strip-types .github/scripts/merge-hitokoto-sentences.ts [options]

Options:
  --input <directory>   Directory containing source JSON files.
  --output <file>       Output file path for the merged JSON array.
  --help                Show this help message.
`);
};

const parseCliOptions = (argv: string[]): CliOptions => {
  let inputDirectoryPath = defaultInputDirectoryPath;
  let outputFilePath = defaultOutputFilePath;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--input") {
      const nextValue = argv[index + 1];

      if (!nextValue) {
        throw new Error("Missing value for --input");
      }

      inputDirectoryPath = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--output") {
      const nextValue = argv[index + 1];

      if (!nextValue) {
        throw new Error("Missing value for --output");
      }

      outputFilePath = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    inputDirectoryPath: path.resolve(process.cwd(), inputDirectoryPath),
    outputFilePath: path.resolve(process.cwd(), outputFilePath),
  };
};

const listSentenceFiles = async (inputDirectoryPath: string): Promise<string[]> => {
  const entries = await fsPromises.readdir(inputDirectoryPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(inputDirectoryPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
};

const writeChunk = async (stream: fs.WriteStream, chunk: string): Promise<void> => {
  if (stream.write(chunk)) {
    return;
  }

  await once(stream, "drain");
};

const readRequiredStringField = (record: SourceSentenceRecord, fieldName: "hitokoto" | "from"): string => {
  const value = record[fieldName];

  if (typeof value !== "string") {
    throw new TypeError(`Expected "${fieldName}" to be a string`);
  }

  return value;
};

const readOptionalStringField = (record: SourceSentenceRecord, fieldName: "from_who"): string | null => {
  const value = record[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected "${fieldName}" to be a string or null`);
  }

  return value;
};

const parseSentenceRecord = (jsonObjectText: string): ReducedSentenceRecord => {
  const parsed = JSON.parse(jsonObjectText) as SourceSentenceRecord | null;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Expected each array item to be a JSON object");
  }

  return {
    hitokoto: readRequiredStringField(parsed, "hitokoto"),
    from: readRequiredStringField(parsed, "from"),
    from_who: readOptionalStringField(parsed, "from_who"),
  };
};

const whitespacePattern = /\s/u;

async function* streamJsonObjects(filePath: string): AsyncGenerator<string> {
  const input = fs.createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: chunkSize,
  });

  let phase: "before-array" | "between-items" | "inside-object" | "after-array" = "before-array";
  let objectBuffer = "";
  let objectDepth = 0;
  let insideString = false;
  let escaping = false;

  for await (const chunk of input) {
    for (const char of chunk) {
      if (phase === "before-array") {
        if (whitespacePattern.test(char)) {
          continue;
        }

        if (char === "[") {
          phase = "between-items";
          continue;
        }

        throw new SyntaxError(`Expected '[' at the start of ${filePath}`);
      }

      if (phase === "between-items") {
        if (whitespacePattern.test(char) || char === ",") {
          continue;
        }

        if (char === "]") {
          phase = "after-array";
          continue;
        }

        if (char === "{") {
          phase = "inside-object";
          objectBuffer = "{";
          objectDepth = 1;
          insideString = false;
          escaping = false;
          continue;
        }

        throw new SyntaxError(`Expected a JSON object inside ${filePath}`);
      }

      if (phase === "after-array") {
        if (whitespacePattern.test(char)) {
          continue;
        }

        throw new SyntaxError(`Unexpected content after JSON array in ${filePath}`);
      }

      objectBuffer += char;

      if (insideString) {
        if (escaping) {
          escaping = false;
          continue;
        }

        if (char === "\\") {
          escaping = true;
          continue;
        }

        if (char === '"') {
          insideString = false;
        }

        continue;
      }

      if (char === '"') {
        insideString = true;
        continue;
      }

      if (char === "{") {
        objectDepth += 1;
        continue;
      }

      if (char !== "}") {
        continue;
      }

      objectDepth -= 1;

      if (objectDepth < 0) {
        throw new SyntaxError(`Unexpected closing brace in ${filePath}`);
      }

      if (objectDepth !== 0) {
        continue;
      }

      yield objectBuffer;
      objectBuffer = "";
      phase = "between-items";
    }
  }

  if (phase === "before-array") {
    throw new SyntaxError(`Missing JSON array in ${filePath}`);
  }

  if (phase === "inside-object" || objectDepth !== 0 || insideString || escaping) {
    throw new SyntaxError(`Unexpected end of file while reading an object in ${filePath}`);
  }
}

const mergeSentenceFiles = async ({ inputDirectoryPath, outputFilePath }: CliOptions): Promise<void> => {
  const sentenceFiles = await listSentenceFiles(inputDirectoryPath);

  if (sentenceFiles.length === 0) {
    throw new Error(`No JSON files were found in ${inputDirectoryPath}`);
  }

  await fsPromises.mkdir(path.dirname(outputFilePath), { recursive: true });

  const output = fs.createWriteStream(outputFilePath, { encoding: "utf8" });
  let fileCount = 0;
  let sentenceCount = 0;
  let needsLeadingComma = false;

  try {
    await writeChunk(output, "[");

    for (const filePath of sentenceFiles) {
      fileCount += 1;

      for await (const jsonObjectText of streamJsonObjects(filePath)) {
        const reducedRecord = parseSentenceRecord(jsonObjectText);

        if (needsLeadingComma) {
          await writeChunk(output, ",");
        }

        await writeChunk(output, JSON.stringify(reducedRecord));
        needsLeadingComma = true;
        sentenceCount += 1;
      }
    }

    await writeChunk(output, "]\n");
    output.end();
    await finished(output);
  } catch (error) {
    output.destroy();
    throw error;
  }

  console.log(`Merged ${sentenceCount} sentences from ${fileCount} files`);
  console.log(`Output: ${outputFilePath}`);

  await appendGitHubOutput("file_count", String(fileCount));
  await appendGitHubOutput("sentence_count", String(sentenceCount));
  await appendGitHubOutput("output_file", outputFilePath);
};

const options = parseCliOptions(process.argv.slice(2));
await mergeSentenceFiles(options);
