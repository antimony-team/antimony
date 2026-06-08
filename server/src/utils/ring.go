package utils

import "bytes"

type (
	RingKind int

	// Ring a ring buffer that stores elements and evicts the oldest elements when full.
	Ring[T any] interface {
		Add(item T)
		AddMany(items []T)
		Items() []T
		Clear()
		Len() int
	}

	// ValueRing a ring buffer that stores values. capacity is defined as the number of items that can be stored.
	ValueRing[T any] struct {
		buf  []T
		head int
		size int
	}

	// ByteRing a ring buffer that stores single bytes. capacity is defined as the number of lines that can be stored.
	ByteRing struct {
		buf      []byte
		lines    int
		maxLines int
	}
)

const (
	/// RingKindValue corresponds to the ValueRing[T] type
	RingKindValue RingKind = iota
	/// RingKindValue corresponds to the ByteRing type
	RingKindByte
)

func CreateRing[O any](kind RingKind, capacity int) Ring[O] {
	switch kind {
	case RingKindByte:
		r, ok := any(CreateByteRing(capacity)).(Ring[O])
		if !ok {
			panic("CreateRing: RingKindByte requires O = byte")
		}
		return r
	default:
		return CreateValueRing[O](capacity)
	}
}

func CreateValueRing[T any](capacity int) *ValueRing[T] {
	return &ValueRing[T]{buf: make([]T, capacity)}
}

func (r *ValueRing[T]) Add(item T) {
	if r.size < len(r.buf) {
		r.buf[(r.head+r.size)%len(r.buf)] = item
		r.size++
	} else {
		r.buf[r.head] = item
		r.head = (r.head + 1) % len(r.buf)
	}
}

func (r *ValueRing[T]) AddMany(items []T) {
	for _, item := range items {
		r.Add(item)
	}
}

func (r *ValueRing[T]) Items() []T {
	out := make([]T, r.size)
	for i := range r.size {
		out[i] = r.buf[(r.head+i)%len(r.buf)]
	}
	return out
}

func (r *ValueRing[T]) Clear() {
	var zero T
	for i := range r.buf {
		r.buf[i] = zero
	}
	r.head = 0
	r.size = 0
}

func (r *ValueRing[T]) Len() int {
	return r.size
}

func CreateByteRing(capacity int) *ByteRing {
	return &ByteRing{maxLines: capacity}
}

func (b *ByteRing) Add(item byte) {
	b.buf = append(b.buf, item)
	if item == '\n' {
		b.lines++
		b.trim()
	}
}

func (b *ByteRing) AddMany(items []byte) {
	b.buf = append(b.buf, items...)
	b.lines += bytes.Count(items, []byte{'\n'})
	b.trim()
}

// / trim If the ring reaches max capacity, will remove the first line from the buffer
func (b *ByteRing) trim() {
	for b.lines > b.maxLines {
		idx := bytes.IndexByte(b.buf, '\n')
		if idx == -1 {
			return
		}
		b.buf = append(b.buf[:0], b.buf[idx+1:]...)
		b.lines--
	}
}

func (b *ByteRing) Items() []byte {
	out := make([]byte, len(b.buf))
	copy(out, b.buf)
	return out
}

func (b *ByteRing) Clear() {
	b.buf = b.buf[:0]
	b.lines = 0
}

func (b *ByteRing) Len() int {
	return len(b.buf)
}
