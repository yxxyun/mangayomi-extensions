import '../../../../../../model/source.dart';

Source get hiperdexSource => _hiperdexSource;

Source _hiperdexSource = Source(
  name: "Hiperdex",
  baseUrl: "https://hiperdex.com",
  lang: "en",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/hiperdex/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "en_us",
);
