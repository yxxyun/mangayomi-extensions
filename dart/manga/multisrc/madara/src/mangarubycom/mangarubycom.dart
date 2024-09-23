import '../../../../../../model/source.dart';

Source get mangarubycomSource => _mangarubycomSource;

Source _mangarubycomSource = Source(
  name: "MangaRuby.com",
  baseUrl: "https://mangaruby.com",
  lang: "en",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/mangarubycom/icon.png",
  dateFormat: "MMMM dd, yyyy",
  dateFormatLocale: "en_us",
);
