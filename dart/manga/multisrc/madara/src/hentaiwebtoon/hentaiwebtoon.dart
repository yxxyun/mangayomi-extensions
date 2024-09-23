import '../../../../../../model/source.dart';

Source get hentaiwebtoonSource => _hentaiwebtoonSource;

Source _hentaiwebtoonSource = Source(
  name: "HentaiWebtoon",
  baseUrl: "https://hentaiwebtoon.com",
  lang: "en",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/hentaiwebtoon/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "en_us",
);
