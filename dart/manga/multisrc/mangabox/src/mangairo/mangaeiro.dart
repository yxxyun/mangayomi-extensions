import '../../../../../../model/source.dart';

Source get mangairoSource => _mangairoSource;

Source _mangairoSource = Source(
  name: "Mangairo",
  baseUrl: "https://h.mangairo.com",
  lang: "en",
  isNsfw: false,
  typeSource: "mangabox",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/mangabox/src/mangairo/icon.png",
  dateFormat: "MMM-dd-yy",
  dateFormatLocale: "en",
);
