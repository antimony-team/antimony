package policy

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// topologyId is the topology the cache tests check, unless they compare it to another one.
const topologyId = "topology-1"

// engineCheck runs the cached check of the topology the way the topology service does.
func engineCheck(t testing.TB, engine *Engine, definition string, bindFiles ...string) []Finding {
	t.Helper()

	raw, typed := parseTopology(t, definition)
	return engine.Check(topologyId, raw, typed, definition, bindFiles)
}

func TestEngine_ReusesTheFindingsOfUnchangedContent(t *testing.T) {
	engine := CreateEngine(Options{})
	definition := nodeTopology("privileged: true")

	first := engineCheck(t, engine, definition)
	require.Len(t, first, 1)

	// A cache hit doesn't look at the parsed definition, so a different one proves the cache answered
	cached := engine.Check(topologyId, nil, nil, definition, nil)
	assert.Equal(t, first, cached)
}

func TestEngine_ChecksChangedContentAgain(t *testing.T) {
	engine := CreateEngine(Options{})

	assert.Len(t, engineCheck(t, engine, nodeTopology("privileged: true")), 1)
	assert.Empty(t, engineCheck(t, engine, nodeTopology("privileged: false")),
		"a changed definition must be checked again")
}

func TestEngine_ChecksChangedBindFilesAgain(t *testing.T) {
	engine := CreateEngine(Options{})
	definition := nodeTopology("startup-config: configs/r1.cfg")

	assert.Len(t, engineCheck(t, engine, definition), 1,
		"the startup config isn't one of the topology's files yet")
	assert.Empty(t, engineCheck(t, engine, definition, "configs/r1.cfg"),
		"adding the bind file must be taken into account")
}

func TestEngine_TheOrderOfBindFilesDoesNotMatter(t *testing.T) {
	assert.Equal(t,
		hashInput("definition", []string{"a.cfg", "b.cfg"}),
		hashInput("definition", []string{"b.cfg", "a.cfg"}))
}

func TestEngine_CachesEachTopologyOnItsOwn(t *testing.T) {
	engine := CreateEngine(Options{})
	definition := nodeTopology("privileged: true")

	engineCheck(t, engine, definition)

	assert.Empty(t, engine.Check("topology-2", nil, nil, definition, nil),
		"another topology with the same content must be checked on its own")
}

func TestEngine_ForgetDropsTheCachedFindings(t *testing.T) {
	engine := CreateEngine(Options{})
	definition := nodeTopology("privileged: true")

	engineCheck(t, engine, definition)
	engine.Forget(topologyId)

	assert.Empty(t, engine.Check(topologyId, nil, nil, definition, nil),
		"after forgetting it, the topology must be checked again")

	assert.NotPanics(t, func() { engine.Forget("unknown") })
}

func TestEngine_CallersCantChangeTheCachedFindings(t *testing.T) {
	engine := CreateEngine(Options{})
	definition := nodeTopology("privileged: true")

	first := engineCheck(t, engine, definition)
	first[0].Message = "changed by the caller"

	second := engine.Check(topologyId, nil, nil, definition, nil)
	assert.NotEqual(t, "changed by the caller", second[0].Message)

	second[0].Message = "changed again"
	assert.NotEqual(t, "changed again", engine.Check(topologyId, nil, nil, definition, nil)[0].Message)
}

func TestEngine_ConcurrentChecksDontShareFindings(t *testing.T) {
	engine := CreateEngine(Options{})

	privileged := nodeTopology("privileged: true")
	privilegedRaw, privilegedTyped := parseTopology(t, privileged)
	clean := nodeTopology("privileged: false")
	cleanRaw, cleanTyped := parseTopology(t, clean)

	var wait sync.WaitGroup
	for index := range 64 {
		wait.Go(func() {
			sharedId := fmt.Sprintf("topology-%d", index%8)

			if index%2 == 0 {
				findings := engine.Check(sharedId+"-privileged", privilegedRaw, privilegedTyped, privileged, nil)
				assert.Len(t, findings, 1)
			} else {
				findings := engine.Check(sharedId+"-clean", cleanRaw, cleanTyped, clean, nil)
				assert.Empty(t, findings)
			}

			engine.Forget(sharedId + "-unrelated")
		})
	}
	wait.Wait()
}

// Each value is written with its length, so moving characters between fields changes the hash.
func TestHashInput_IsUnambiguous(t *testing.T) {
	hashes := map[[32]byte]string{}

	for name, input := range map[string]struct {
		definition string
		bindFiles  []string
	}{
		"definition only":           {definition: "ab"},
		"split into a bind file":    {definition: "a", bindFiles: []string{"b"}},
		"split into two bind files": {definition: "", bindFiles: []string{"a", "b"}},
		"one joined bind file":      {definition: "", bindFiles: []string{"ab"}},
		"an empty bind file":        {definition: "ab", bindFiles: []string{""}},
	} {
		hash := hashInput(input.definition, input.bindFiles)
		if other, isTaken := hashes[hash]; isTaken {
			t.Fatalf("%q and %q have the same hash", name, other)
		}
		hashes[hash] = name
	}
}
