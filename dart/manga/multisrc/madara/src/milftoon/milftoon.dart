import '../../../../../../model/source.dart';

Source get milftoonSource => _milftoonSource;

Source _milftoonSource = Source(
  name: "Milftoon",
  baseUrl: "https://milftoon.xxx",
  lang: "en",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/milftoon/icon.png",
  dateFormat: "d MMMM, yyyy",
  dateFormatLocale: "en_us",
);
