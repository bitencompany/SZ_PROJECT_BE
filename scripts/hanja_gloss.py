"""Parse Korean glosses only within an explicitly indexed reading row."""
import re

def same_reading(source, target):
    if source == target:
        return True
    # The dictionary row already indexes the target (e.g. 이:李:오얏 리).
    # This strips a historical initial in that row; it does not create readings.
    a, b = ord(source) - 0xac00, ord(target) - 0xac00
    if a % 588 != b % 588:
        return False
    initials, vowel = (a // 588, b // 588), (a % 588) // 28
    if initials == (5, 2):
        return vowel in [0, 1, 4, 5, 8, 13, 18]
    if initials in [(5, 11), (2, 11)]:
        return vowel in [2, 6, 7, 12, 17, 20]
    return False

def parse_glosses(raw, reading):
    meanings = []
    for gloss in raw.split(','):
        match = re.fullmatch(r'(.+?)\s+([가-힣])', gloss.strip())
        if match and same_reading(match[2], reading) and match[1] not in meanings:
            meanings.append(match[1])
    return meanings
