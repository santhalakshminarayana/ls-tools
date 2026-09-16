package main

import (
	"bytes"
	"context"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	pathpkg "path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const standardPackageListTimeout = 5 * time.Second

type importCandidate struct {
	name string
	path string
}

var standardPackageCache = struct {
	sync.Mutex
	byBinary map[string]map[string]string
}{byBinary: make(map[string]map[string]string)}

var commonStandardPackages = map[string]string{
	"base64":  "encoding/base64",
	"bufio":   "bufio",
	"bytes":   "bytes",
	"context": "context",
	"csv":     "encoding/csv",
	"errors":  "errors",
	"fmt":     "fmt",
	"hex":     "encoding/hex",
	"http":    "net/http",
	"io":      "io",
	"json":    "encoding/json",
	"log":     "log",
	"maps":    "maps",
	"math":    "math",
	"os":      "os",
	"reflect": "reflect",
	"regexp":  "regexp",
	"runtime": "runtime",
	"slices":  "slices",
	"sort":    "sort",
	"strconv": "strconv",
	"strings": "strings",
	"sync":    "sync",
	"time":    "time",
	"url":     "net/url",
	"xml":     "encoding/xml",
}

func standardPackagesFor(spec languageSpec) map[string]string {
	standardPackageCache.Lock()
	defer standardPackageCache.Unlock()

	if cached, ok := standardPackageCache.byBinary[spec.binary]; ok {
		return cached
	}

	packages := copyStringMap(commonStandardPackages)
	ctx, cancel := context.WithTimeout(context.Background(), standardPackageListTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, spec.binary, "list", "-f", "{{.Name}}\t{{.ImportPath}}", "std")
	cmd.Env = environmentWithOverrides(os.Environ(), spec.env...)
	output, err := cmd.Output()
	if err == nil {
		packages = unambiguousStandardPackages(string(output))
		for name, importPath := range commonStandardPackages {
			if _, exists := packages[name]; !exists {
				packages[name] = importPath
			}
		}
	}

	standardPackageCache.byBinary[spec.binary] = packages
	return packages
}

func unambiguousStandardPackages(output string) map[string]string {
	pathsByName := make(map[string][]string)
	for _, line := range strings.Split(output, "\n") {
		fields := strings.SplitN(strings.TrimSpace(line), "\t", 2)
		if len(fields) != 2 {
			continue
		}
		name, importPath := fields[0], fields[1]
		if name == "main" || importPath == "" || importPath == "internal" ||
			strings.HasPrefix(importPath, "internal/") || strings.Contains(importPath, "/internal/") ||
			strings.HasPrefix(importPath, "cmd/") || strings.Contains(importPath, "/vendor/") {
			continue
		}
		pathsByName[name] = append(pathsByName[name], importPath)
	}

	result := make(map[string]string)
	for name, importPaths := range pathsByName {
		if len(importPaths) == 1 {
			result[name] = importPaths[0]
		}
	}
	return result
}

func copyStringMap(source map[string]string) map[string]string {
	result := make(map[string]string, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func prepareGoCode(source string, packages map[string]string) string {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "main.go", source, parser.ParseComments)
	if err != nil {
		return source
	}

	usedSelectors := make(map[string]struct{})
	ast.Inspect(file, func(node ast.Node) bool {
		selector, ok := node.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		identifier, ok := selector.X.(*ast.Ident)
		if ok && identifier.Obj == nil {
			usedSelectors[identifier.Name] = struct{}{}
		}
		return true
	})
	removeUnusedKnownImports(file, packages, usedSelectors)

	existingImports := make(map[string]struct{})
	for _, declaration := range file.Decls {
		importDeclaration, ok := declaration.(*ast.GenDecl)
		if !ok || importDeclaration.Tok != token.IMPORT {
			continue
		}
		for _, rawSpec := range importDeclaration.Specs {
			spec := rawSpec.(*ast.ImportSpec)
			name := importName(spec)
			if name != "" && name != "." && name != "_" {
				existingImports[name] = struct{}{}
			}
		}
	}

	neededByName := make(map[string]string)
	for name := range usedSelectors {
		if _, exists := existingImports[name]; exists {
			continue
		}
		if importPath, exists := packages[name]; exists {
			neededByName[name] = importPath
		}
	}

	candidates := make([]importCandidate, 0, len(neededByName))
	for name, importPath := range neededByName {
		candidates = append(candidates, importCandidate{name: name, path: importPath})
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].path < candidates[j].path
	})
	if len(candidates) > 0 {
		addImports(file, candidates)
	}

	var formatted bytes.Buffer
	if err := format.Node(&formatted, fset, file); err != nil {
		return source
	}
	cleaned, err := format.Source(formatted.Bytes())
	if err != nil {
		return source
	}
	return string(cleaned)
}

func removeUnusedKnownImports(file *ast.File, packages map[string]string, usedSelectors map[string]struct{}) {
	nameByPath := make(map[string]string, len(packages))
	for name, importPath := range packages {
		nameByPath[importPath] = name
	}

	declarations := file.Decls[:0]
	for _, declaration := range file.Decls {
		importDeclaration, ok := declaration.(*ast.GenDecl)
		if !ok || importDeclaration.Tok != token.IMPORT {
			declarations = append(declarations, declaration)
			continue
		}

		kept := importDeclaration.Specs[:0]
		for _, rawSpec := range importDeclaration.Specs {
			spec := rawSpec.(*ast.ImportSpec)
			name := importName(spec)
			if name == "." || name == "_" || spec.Doc != nil || spec.Comment != nil {
				kept = append(kept, spec)
				continue
			}

			removable := spec.Name != nil
			if spec.Name == nil {
				importPath, err := strconv.Unquote(spec.Path.Value)
				if err == nil {
					knownName, known := nameByPath[importPath]
					if known {
						name = knownName
						removable = true
					}
				}
			}
			_, used := usedSelectors[name]
			if !removable || used {
				kept = append(kept, spec)
			}
		}
		importDeclaration.Specs = kept
		if len(kept) > 0 {
			declarations = append(declarations, importDeclaration)
		}
	}
	file.Decls = declarations
}

func importName(spec *ast.ImportSpec) string {
	if spec.Name != nil {
		return spec.Name.Name
	}
	importPath, err := strconv.Unquote(spec.Path.Value)
	if err != nil {
		return ""
	}
	return pathpkg.Base(importPath)
}

func addImports(file *ast.File, candidates []importCandidate) {
	var importDeclaration *ast.GenDecl
	for _, declaration := range file.Decls {
		candidate, ok := declaration.(*ast.GenDecl)
		if ok && candidate.Tok == token.IMPORT {
			importDeclaration = candidate
			break
		}
	}

	if importDeclaration == nil {
		importDeclaration = &ast.GenDecl{Tok: token.IMPORT, TokPos: file.Name.End() + 1}
		file.Decls = append([]ast.Decl{importDeclaration}, file.Decls...)
	}
	for _, candidate := range candidates {
		spec := &ast.ImportSpec{
			Path: &ast.BasicLit{Kind: token.STRING, Value: strconv.Quote(candidate.path)},
		}
		if pathpkg.Base(candidate.path) != candidate.name {
			spec.Name = ast.NewIdent(candidate.name)
		}
		importDeclaration.Specs = append(importDeclaration.Specs, spec)
	}
	if len(importDeclaration.Specs) > 1 {
		importDeclaration.Lparen = importDeclaration.TokPos
	}
}
