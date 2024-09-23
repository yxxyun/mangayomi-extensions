import '../../../../../../model/source.dart';

Source get doujinzaSource => _doujinzaSource;
Source _doujinzaSource = Source(
    name: "DoujinZa",
    baseUrl: "https://doujinza.com",
    lang: "th",
    isNsfw: false,
    typeSource: "madara",
    iconUrl:
        "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/bbranchNamee/dart/manga/multisrc/madara/src/doujinza/icon.png",
    dateFormat: "MMMM d, yyyy",
    dateFormatLocale: "th");
