// Stands in for expo-file-system's document folder, keyed by file name:
// jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').expoFileSystem).
export const memoryFiles = new Map<string, string>();

class File {
  name: string;
  constructor(_directory: unknown, name: string) {
    this.name = name;
  }
  get exists() {
    return memoryFiles.has(this.name);
  }
  create() {
    if (memoryFiles.has(this.name)) throw new Error(`${this.name} already exists`);
    memoryFiles.set(this.name, '');
  }
  textSync() {
    const text = memoryFiles.get(this.name);
    if (text === undefined) throw new Error(`${this.name} does not exist`);
    return text;
  }
  write(text: string) {
    if (!memoryFiles.has(this.name)) throw new Error(`${this.name} does not exist`);
    memoryFiles.set(this.name, text);
  }
}

export const expoFileSystem = { File, Paths: { document: 'documents' } };
