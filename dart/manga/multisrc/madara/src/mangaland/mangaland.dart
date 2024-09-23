import '../../../../../../model/source.dart';

Source get mangalandSource => _mangalandSource;

Source _mangalandSource = Source(
  name: "Mangaland",
  baseUrl: "https://mangaland.net",
  lang: "es",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/mangaland/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "es",
);
