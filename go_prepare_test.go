package main

import (
	"strings"
	"testing"
)

func TestPrepareGoCodeAddsMissingImportsAndFormats(t *testing.T) {
	source := `package main
func main(){fmt.Println(strings.ToUpper("ok"))}
`
	prepared := prepareGoCode(source, map[string]string{
		"fmt":     "fmt",
		"strings": "strings",
	})
	want := `package main

import (
	"fmt"
	"strings"
)

func main() { fmt.Println(strings.ToUpper("ok")) }
`
	if prepared != want {
		t.Fatalf("prepared source:\n%s\nwant:\n%s", prepared, want)
	}
}

func TestPrepareGoCodeKeepsAliasesAndLocalSelectors(t *testing.T) {
	aliased := `package main
import f "fmt"
func main(){f.Println("ok")}
`
	preparedAlias := prepareGoCode(aliased, map[string]string{"fmt": "fmt"})
	if strings.Count(preparedAlias, `"fmt"`) != 1 {
		t.Fatalf("aliased import was duplicated:\n%s", preparedAlias)
	}

	localSelector := `package main
type printer struct{}
func (printer) Println(string){}
func main(){fmt := printer{}; fmt.Println("ok")}
`
	preparedLocal := prepareGoCode(localSelector, map[string]string{"fmt": "fmt"})
	if strings.Contains(preparedLocal, `import "fmt"`) {
		t.Fatalf("local selector was mistaken for a package:\n%s", preparedLocal)
	}
}

func TestPrepareGoCodeLeavesMalformedSourceForCompilerDiagnostics(t *testing.T) {
	source := "package main\nfunc main(\n"
	if prepared := prepareGoCode(source, commonStandardPackages); prepared != source {
		t.Fatalf("malformed source changed to %q", prepared)
	}
}

func TestPrepareGoCodeRemovesUnusedKnownImports(t *testing.T) {
	source := `package main
import "fmt"
func main(){println("ok")}
`
	prepared := prepareGoCode(source, map[string]string{"fmt": "fmt"})
	if strings.Contains(prepared, `"fmt"`) {
		t.Fatalf("unused standard import remained:\n%s", prepared)
	}
	if !strings.Contains(prepared, `func main() { println("ok") }`) {
		t.Fatalf("source was not formatted:\n%s", prepared)
	}
}

func TestStandardPackageIndexRejectsAmbiguousAndInternalPackages(t *testing.T) {
	index := unambiguousStandardPackages(strings.Join([]string{
		"fmt\tfmt",
		"rand\tcrypto/rand",
		"rand\tmath/rand",
		"abi\tinternal/abi",
		"http\tnet/http",
	}, "\n"))
	if index["fmt"] != "fmt" || index["http"] != "net/http" {
		t.Fatalf("missing unambiguous packages: %#v", index)
	}
	if _, exists := index["rand"]; exists {
		t.Fatalf("ambiguous package was accepted: %#v", index)
	}
	if _, exists := index["abi"]; exists {
		t.Fatalf("internal package was accepted: %#v", index)
	}
}
