import '../../../../../../model/source.dart';

Source get vinmangaSource => _vinmangaSource;

Source _vinmangaSource = Source(
  name: "VinManga",
  baseUrl: "https://vinload.com",
  lang: "en",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/vinmanga/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "en_us",
);
