import '../../../../../../model/source.dart';

Source get manhwaxSource => _manhwaxSource;

Source _manhwaxSource = Source(
  name: "Manhwax",
  baseUrl: "https://manhwax.com",
  lang: "en",
  isNsfw: false,
  typeSource: "mangareader",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/mangareader/src/manhwax/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "en_us",
);
