package storage

import "errors"

// ErrNotFound is returned when a requested record does not exist.
var ErrNotFound = errors.New("not found")

// ErrDuplicate is returned when a unique constraint would be violated.
var ErrDuplicate = errors.New("duplicate")
