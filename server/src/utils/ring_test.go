package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/*
 * ValueRing
 */

func TestValueRing_StartsEmpty(t *testing.T) {
	ring := CreateValueRing[int](3)

	assert.Equal(t, 0, ring.Len())
	assert.Empty(t, ring.Items())
}

func TestValueRing_KeepsInsertionOrderBelowCapacity(t *testing.T) {
	ring := CreateValueRing[int](5)

	ring.Add(1)
	ring.Add(2)
	ring.Add(3)

	assert.Equal(t, 3, ring.Len())
	assert.Equal(t, []int{1, 2, 3}, ring.Items())
}

func TestValueRing_FillsExactlyToCapacity(t *testing.T) {
	ring := CreateValueRing[int](3)

	ring.Add(1)
	ring.Add(2)
	ring.Add(3)

	assert.Equal(t, 3, ring.Len())
	assert.Equal(t, []int{1, 2, 3}, ring.Items())
}

func TestValueRing_EvictsOldestWhenFull(t *testing.T) {
	ring := CreateValueRing[int](3)

	for value := 1; value <= 5; value++ {
		ring.Add(value)
	}

	assert.Equal(t, 3, ring.Len(), "the length must stay clamped to the capacity")
	assert.Equal(t, []int{3, 4, 5}, ring.Items(), "the oldest entries must be evicted in order")
}

func TestValueRing_WrapsRepeatedly(t *testing.T) {
	ring := CreateValueRing[int](3)

	// Several full laps around the buffer, to catch an index that drifts.
	for value := 1; value <= 100; value++ {
		ring.Add(value)
	}

	assert.Equal(t, []int{98, 99, 100}, ring.Items())
}

func TestValueRing_AddManyBelowCapacity(t *testing.T) {
	ring := CreateValueRing[string](4)

	ring.AddMany([]string{"a", "b"})

	assert.Equal(t, []string{"a", "b"}, ring.Items())
}

func TestValueRing_AddManyOverCapacityKeepsTheTail(t *testing.T) {
	ring := CreateValueRing[string](3)

	ring.AddMany([]string{"a", "b", "c", "d", "e"})

	assert.Equal(t, []string{"c", "d", "e"}, ring.Items())
}

func TestValueRing_AddManyEmptySliceIsANoOp(t *testing.T) {
	ring := CreateValueRing[int](3)

	ring.Add(1)
	ring.AddMany(nil)

	assert.Equal(t, []int{1}, ring.Items())
}

func TestValueRing_ClearResetsToEmpty(t *testing.T) {
	ring := CreateValueRing[int](3)

	ring.AddMany([]int{1, 2, 3, 4})
	ring.Clear()

	assert.Equal(t, 0, ring.Len())
	assert.Empty(t, ring.Items())

	// The ring must still be usable, and start counting from the beginning again.
	ring.Add(9)
	assert.Equal(t, []int{9}, ring.Items())
}

func TestValueRing_ItemsReturnsACopy(t *testing.T) {
	ring := CreateValueRing[int](3)
	ring.AddMany([]int{1, 2, 3})

	items := ring.Items()
	items[0] = 99

	assert.Equal(t, []int{1, 2, 3}, ring.Items(), "mutating the returned slice must not affect the ring")
}

// TestValueRing_ZeroCapacityPanics pins a latent crash rather than endorsing it.
//
// A zero-capacity ValueRing panics on the very first Add, because the "buffer is full" branch
// indexes into a zero-length slice. This is reachable from configuration: setting
// streaming.clabLogBacklog (or containerLogBacklog / shellLinesBacklog) to 0 in the config file
// produces a namespace whose backlog ring panics as soon as the first log line is emitted.
//
// A zero capacity should either be rejected at config load or treated as "no backlog".
func TestValueRing_ZeroCapacityPanics(t *testing.T) {
	ring := CreateValueRing[int](0)

	assert.Panics(t, func() { ring.Add(1) })
}

/*
 * ByteRing
 */

func TestByteRing_StartsEmpty(t *testing.T) {
	ring := CreateByteRing(3)

	assert.Equal(t, 0, ring.Len())
	assert.Empty(t, ring.Items())
}

func TestByteRing_LenCountsBytesNotLines(t *testing.T) {
	ring := CreateByteRing(10)

	ring.AddMany([]byte("abc\n"))

	assert.Equal(t, 4, ring.Len(), "Len is the byte length of the buffer")
}

func TestByteRing_KeepsContentBelowLineLimit(t *testing.T) {
	ring := CreateByteRing(3)

	ring.AddMany([]byte("one\ntwo\n"))

	assert.Equal(t, "one\ntwo\n", string(ring.Items()))
}

func TestByteRing_TrimsOldestLinesOverTheLimit(t *testing.T) {
	ring := CreateByteRing(2)

	ring.AddMany([]byte("one\ntwo\nthree\n"))

	assert.Equal(t, "two\nthree\n", string(ring.Items()), "the oldest line must be dropped")
}

func TestByteRing_TrimsWhenAddingByteByByte(t *testing.T) {
	ring := CreateByteRing(2)

	for _, b := range []byte("one\ntwo\nthree\n") {
		ring.Add(b)
	}

	assert.Equal(t, "two\nthree\n", string(ring.Items()))
}

func TestByteRing_KeepsAPartialTrailingLine(t *testing.T) {
	ring := CreateByteRing(2)

	ring.AddMany([]byte("one\ntwo\npartial"))

	// "partial" has no newline yet, so it is not counted as a line and must be preserved.
	assert.Equal(t, "one\ntwo\npartial", string(ring.Items()))
}

func TestByteRing_ContentWithoutNewlinesIsNeverTrimmed(t *testing.T) {
	ring := CreateByteRing(1)

	ring.AddMany([]byte("no newlines here at all"))

	assert.Equal(t, "no newlines here at all", string(ring.Items()))
}

func TestByteRing_ClearResetsToEmpty(t *testing.T) {
	ring := CreateByteRing(5)

	ring.AddMany([]byte("one\ntwo\n"))
	ring.Clear()

	assert.Equal(t, 0, ring.Len())
	assert.Empty(t, ring.Items())

	ring.AddMany([]byte("fresh\n"))
	assert.Equal(t, "fresh\n", string(ring.Items()))
}

func TestByteRing_ItemsReturnsACopy(t *testing.T) {
	ring := CreateByteRing(5)
	ring.AddMany([]byte("abc"))

	items := ring.Items()
	items[0] = 'z'

	assert.Equal(t, "abc", string(ring.Items()))
}

func TestByteRing_ZeroLineLimitKeepsOnlyThePartialLine(t *testing.T) {
	ring := CreateByteRing(0)

	ring.AddMany([]byte("one\ntwo\ntail"))

	// Every completed line is trimmed away; only the unterminated remainder survives.
	assert.Equal(t, "tail", string(ring.Items()))
}

/*
 * CreateRing
 */

func TestCreateRing_ValueKindReturnsAValueRing(t *testing.T) {
	ring := CreateRing[string](RingKindValue, 2)
	require.NotNil(t, ring)

	ring.AddMany([]string{"a", "b", "c"})

	assert.Equal(t, []string{"b", "c"}, ring.Items())
}

func TestCreateRing_ByteKindReturnsAByteRing(t *testing.T) {
	ring := CreateRing[byte](RingKindByte, 2)
	require.NotNil(t, ring)

	ring.AddMany([]byte("one\ntwo\nthree\n"))

	assert.Equal(t, "two\nthree\n", string(ring.Items()))
}

func TestCreateRing_ByteKindWithNonByteElementPanics(t *testing.T) {
	// A ByteRing only satisfies Ring[byte]; asking for any other element type is a programming
	// error the constructor refuses loudly rather than silently returning the wrong ring.
	assert.PanicsWithValue(t, "CreateRing: RingKindByte requires O = byte", func() {
		CreateRing[string](RingKindByte, 2)
	})
}

func TestCreateRing_UnknownKindFallsBackToValueRing(t *testing.T) {
	ring := CreateRing[int](RingKind(99), 2)
	require.NotNil(t, ring)

	ring.AddMany([]int{1, 2, 3})

	assert.Equal(t, []int{2, 3}, ring.Items())
}
