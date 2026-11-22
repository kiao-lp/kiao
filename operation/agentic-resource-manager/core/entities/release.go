package entities

import (
	"cmp"
	"math"
	"strconv"
	"strings"
)

type ReleaseBump string

const (
	BumpMajor ReleaseBump = "major"
	BumpMinor ReleaseBump = "minor"
	BumpPatch ReleaseBump = "patch"
)

type ReleaseVersion [3]uint64

func ParseReleaseVersion(value string) (ReleaseVersion, bool) {
	var version ReleaseVersion
	parts := strings.Split(value, ".")
	if len(parts) != len(version) {
		return version, false
	}
	for i, part := range parts {
		number, err := strconv.ParseUint(part, 10, 64)
		if err != nil || part != strconv.FormatUint(number, 10) {
			return ReleaseVersion{}, false
		}
		version[i] = number
	}
	return version, true
}

func (v ReleaseVersion) String() string {
	return strconv.FormatUint(v[0], 10) + "." + strconv.FormatUint(v[1], 10) + "." + strconv.FormatUint(v[2], 10)
}

func (v ReleaseVersion) Compare(other ReleaseVersion) int {
	for i, part := range v {
		if order := cmp.Compare(part, other[i]); order != 0 {
			return order
		}
	}
	return 0
}

func (v ReleaseVersion) Bump(bump ReleaseBump) (ReleaseVersion, error) {
	var component int
	switch bump {
	case BumpMajor:
		component = 0
	case BumpMinor:
		component = 1
	case "", BumpPatch:
		component = 2
	default:
		return v, Invalidf("version bump must be major, minor or patch")
	}
	if v[component] == math.MaxUint64 {
		return v, Invalidf("cannot bump version %s", v)
	}
	v[component]++
	clear(v[component+1:])
	return v, nil
}
