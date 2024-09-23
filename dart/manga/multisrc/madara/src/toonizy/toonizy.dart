import '../../../../../../model/source.dart';

Source get toonizySource => _toonizySource;

Source _toonizySource = Source(
  name: "Toonizy",
  baseUrl: "https://toonizy.com",
  lang: "en",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/toonizy/icon.png",
  dateFormat: "MMM d, yy",
  dateFormatLocale: "en",
);
