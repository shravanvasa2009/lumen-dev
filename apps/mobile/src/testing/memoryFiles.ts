// Stands in for expo-file-system's document folder, keyed by file name. Import it before the module under
// test, then: jest.mock('expo-file-system', () => mockFileSystem). The `mock` prefix lets jest hoist that.
export const memoryFiles = new Map<string, string>();

class File {
  name: string;
  // A folder and a name (Paths.document, 'x.json') keep just the name; a lone URI keeps itself.
  constructor(...parts: string[]) {
    this.name = parts[parts.length - 1] ?? '';
  }
  get uri() {
    return this.name;
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
  delete() {
    if (!memoryFiles.delete(this.name)) throw new Error(`${this.name} does not exist`);
  }
  write(text: string) {
    if (!memoryFiles.has(this.name)) throw new Error(`${this.name} does not exist`);
    memoryFiles.set(this.name, text);
  }
}

class Directory {
  path: string;
  constructor(...parts: string[]) {
    this.path = parts.join('/');
  }
  private contents() {
    return [...memoryFiles.keys()].filter((name) => name.startsWith(`${this.path}/`));
  }
  get exists() {
    return this.contents().length > 0;
  }
  delete() {
    if (!this.exists) throw new Error(`${this.path} does not exist`);
    for (const name of this.contents()) memoryFiles.delete(name);
  }
}

export const mockFileSystem = { File, Directory, Paths: { document: 'documents', cache: 'cache' } };
