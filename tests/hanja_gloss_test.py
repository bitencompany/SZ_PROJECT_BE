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

    def test_indexed_bare_korean_gloss(self):
        self.assertEqual(parse_glosses('강할', '강'), ['강할'])
        self.assertEqual(parse_glosses('조나라 서울', '감'), ['조나라 서울'])
        self.assertEqual(parse_glosses('끝', '말'), ['끝'])

    def test_bare_gloss_does_not_inherit_another_reading_or_variant(self):
        self.assertEqual(parse_glosses('검붉을 안', '은'), [])
        self.assertEqual(parse_glosses('歌와 同字', '가'), [])
        self.assertEqual(parse_glosses('밝을 명, malformed', '은'), [])

if __name__ == '__main__':
    unittest.main()
