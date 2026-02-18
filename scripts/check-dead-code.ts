import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

interface ExportSymbol {
  filePath: string;
  line: number;
  name: string;
}

function normalizePath(path: string): string {
  return resolve(path);
}

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function resolveLocalImportPath(fromFilePath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const basePath = resolve(dirname(fromFilePath), specifier);
  const candidates = [basePath, `${basePath}.ts`, join(basePath, 'index.ts')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return normalizePath(candidate);
    }
  }

  return null;
}

function collectExportSymbols(sourceFile: ts.SourceFile): ExportSymbol[] {
  const symbols: ExportSymbol[] = [];

  const pushSymbol = (node: ts.Node, name: string): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    symbols.push({
      filePath: normalizePath(sourceFile.fileName),
      line: line + 1,
      name
    });
  };

  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      hasExportModifier(statement) &&
      statement.name !== undefined
    ) {
      pushSymbol(statement.name, statement.name.text);
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          pushSymbol(declaration.name, declaration.name.text);
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          pushSymbol(element.name, element.name.text);
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      pushSymbol(statement, 'default');
    }
  }

  return symbols;
}

function collectImportedNames(
  sourceFile: ts.SourceFile,
  importedNamesByFile: Map<string, Set<string>>,
  referencedSourceFiles: Set<string>
): void {
  const fromFilePath = normalizePath(sourceFile.fileName);

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const targetPath = resolveLocalImportPath(fromFilePath, statement.moduleSpecifier.text);
    if (targetPath === null) {
      continue;
    }

    if (targetPath.includes(`${resolve(process.cwd(), 'src')}/`)) {
      referencedSourceFiles.add(targetPath);
    }

    const names = importedNamesByFile.get(targetPath) ?? new Set<string>();
    const clause = statement.importClause;
    if (clause === undefined) {
      names.add('*');
      importedNamesByFile.set(targetPath, names);
      continue;
    }

    if (clause.name !== undefined) {
      names.add('default');
    }

    if (clause.namedBindings !== undefined) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.add('*');
      } else {
        for (const element of clause.namedBindings.elements) {
          names.add(element.propertyName?.text ?? element.name.text);
        }
      }
    }

    importedNamesByFile.set(targetPath, names);
  }
}

function main(): number {
  const root = process.cwd();
  const srcRoot = resolve(root, 'src');
  const testRoot = resolve(root, 'test');
  const scriptsRoot = resolve(root, 'scripts');
  const srcFiles = ts.sys.readDirectory(srcRoot, ['.ts'], undefined, ['**/*.ts']).map(normalizePath);
  const testFiles = ts.sys.readDirectory(testRoot, ['.ts'], undefined, ['**/*.ts']).map(normalizePath);
  const scriptFiles = ts.sys
    .readDirectory(scriptsRoot, ['.ts'], undefined, ['**/*.ts'])
    .map(normalizePath);
  const allFiles = [...new Set([...srcFiles, ...testFiles, ...scriptFiles])];

  const importedNamesByFile = new Map<string, Set<string>>();
  const referencedSourceFiles = new Set<string>();
  const exportSymbols: ExportSymbol[] = [];

  for (const filePath of allFiles) {
    const sourceText = readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    collectImportedNames(sourceFile, importedNamesByFile, referencedSourceFiles);
    if (filePath.startsWith(srcRoot)) {
      exportSymbols.push(...collectExportSymbols(sourceFile));
    }
  }

  const deadExports = exportSymbols.filter((symbol) => {
    const importedNames = importedNamesByFile.get(symbol.filePath);
    if (importedNames === undefined) {
      return true;
    }
    if (importedNames.has('*')) {
      return false;
    }
    return !importedNames.has(symbol.name);
  });

  const deadFiles = srcFiles.filter((filePath) => {
    return !referencedSourceFiles.has(filePath);
  });

  if (deadExports.length === 0 && deadFiles.length === 0) {
    return 0;
  }

  for (const symbol of deadExports) {
    const relPath = relative(root, symbol.filePath);
    process.stderr.write(`dead export: ${relPath}:${symbol.line} ${symbol.name}\n`);
  }
  for (const filePath of deadFiles) {
    const relPath = relative(root, filePath);
    process.stderr.write(`dead file: ${relPath}\n`);
  }

  return 1;
}

process.exitCode = main();
