import unittest
from scripts.hanja_gloss import parse_glosses

class HanjaGlossTest(unittest.TestCase):
    def test_reading_specific_meanings(self):
        self.assertEqual(parse_glosses('풍류 악, 좋아할 요, 즐길 락', '악'), ['풍류'])

    def test_initial_sound_in_explicit_dictionary_row(self):
        self.assertEqual(parse_glosses('오얏 리, 선비 천거리할 리', '이'), ['오얏', '선비 천거리할'])
        self.assertEqual(parse_glosses('헤아릴 률', '율'), ['헤아릴'])

    def test_malformed_and_different_readings_not_guessed(self):
        self.assertEqual(parse_glosses('클 태, 타이, 통할 태, 클 태', '태'), ['클', '통할'])
        self.assertEqual(parse_glosses('많을 은, 검붉을 안', '은'), ['많을'])
        self.assertEqual(parse_glosses('', '태'), [])

if __name__ == '__main__':
    unittest.main()
