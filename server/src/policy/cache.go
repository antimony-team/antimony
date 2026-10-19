package policy

import (
	"crypto/sha256"
	"encoding/binary"
	"hash"
	"slices"
	"sync"
)

// findingsCache stores the findings of each topology together with the hash of the content they belong to.
type findingsCache struct {
	mutex   sync.Mutex
	entries map[string]cacheEntry
}

type cacheEntry struct {
	hash     [sha256.Size]byte
	findings []Finding
}

// createFindingsCache creates an empty findings cache.
func createFindingsCache() *findingsCache {
	return &findingsCache{entries: make(map[string]cacheEntry)}
}

// get returns the cached findings of a topology if they belong to the given content hash.
func (c *findingsCache) get(topologyId string, contentHash [sha256.Size]byte) ([]Finding, bool) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	entry, ok := c.entries[topologyId]
	if !ok || entry.hash != contentHash {
		return nil, false
	}
	return slices.Clone(entry.findings), true
}

// set stores the findings of a topology for the given content hash.
func (c *findingsCache) set(topologyId string, contentHash [sha256.Size]byte, findings []Finding) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	c.entries[topologyId] = cacheEntry{hash: contentHash, findings: slices.Clone(findings)}
}

// forget removes a topology from the cache.
func (c *findingsCache) forget(topologyId string) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	delete(c.entries, topologyId)
}

// hashInput hashes the definition and the sorted bind file paths unambiguously.
func hashInput(definitionString string, bindFilePaths []string) [sha256.Size]byte {
	hasher := sha256.New()

	writeField(hasher, definitionString)
	for _, bindFile := range slices.Sorted(slices.Values(bindFilePaths)) {
		writeField(hasher, bindFile)
	}

	var sum [sha256.Size]byte
	hasher.Sum(sum[:0])
	return sum
}

// writeField writes a value with its length prefix, so different inputs never produce the same stream.
func writeField(hasher hash.Hash, value string) {
	hasher.Write(binary.BigEndian.AppendUint64(nil, uint64(len(value))))
	hasher.Write([]byte(value))
}
