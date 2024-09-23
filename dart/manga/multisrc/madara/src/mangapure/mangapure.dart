import '../../../../../../model/source.dart';

Source get mangapureSource => _mangapureSource;

Source _mangapureSource = Source(
  name: "MangaPure",
  baseUrl: "https://mangapure.net",
  lang: "en",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/mangapure/icon.png",
  dateFormat: "MMM dd, HH:mm",
  dateFormatLocale: "en",
);
