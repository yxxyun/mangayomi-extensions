import '../../../../../../model/source.dart';

Source get birdtoonSource => _birdtoonSource;

Source _birdtoonSource = Source(
  name: "BirdToon",
  baseUrl: "https://birdtoon.net",
  lang: "id",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/birdtoon/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "en_us",
);
