import '../../../../../../model/source.dart';

Source get yaoicomicsSource => _yaoicomicsSource;

Source _yaoicomicsSource = Source(
  name: "Yaoi Comics",
  baseUrl: "https://ycscan.com",
  lang: "pt-BR",
  isNsfw: false,
  typeSource: "madara",
  iconUrl:
      "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/$branchName/dart/manga/multisrc/madara/src/yaoicomics/icon.png",
  dateFormat: "dd 'de' MMMMM 'de' yyyy",
  dateFormatLocale: "pt-br",
);
