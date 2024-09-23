import '../../../../../../model/source.dart';

Source get kanzeninSource => _kanzeninSource;

Source _kanzeninSource = Source(
  name: "Kanzenin",
  baseUrl: "https://kanzenin.xyz",
  lang: "id",
  isNsfw: false,
  typeSource: "mangareader",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/mangareader/src/kanzenin/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "en_us",
);
