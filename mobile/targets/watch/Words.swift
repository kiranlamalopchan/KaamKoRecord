import Foundation

/// The watch in English or in Nepali — whichever the phone is set to.
///
/// As on the phone (src/i18n), the English sentence is the key and a sentence
/// with no Nepali yet stays in English. Keep this list in step with the Wear OS
/// app's Words.kt and, where a sentence is shared, with the phone's ne.ts.
enum Words {
  static var lang: String { Link.shared.lang }

  static let ne: [String: String] = [
    "Clock in": "क्लक इन",
    "Clock out": "क्लक आउट",
    "Clock out?": "क्लक आउट गर्ने?",
    "Start break": "ब्रेक सुरु",
    "End break": "ब्रेक सकियो",
    "Working": "काम गर्दै",
    "On break": "ब्रेकमा",
    "Cancel": "रद्द गर्नुहोस्",
    "Workplace": "कार्यस्थल",
    "Since {time}": "{time} देखि",
    "Break since {time}": "{time} देखि ब्रेकमा",
    "Worked {time}": "{time} काम",
    "Sign in on your phone": "फोनमा साइन इन गर्नुहोस्",
    "Open KaamKoRecord on your phone and sign in. Your watch follows.": "फोनमा KaamKoRecord खोलेर साइन इन गर्नुहोस्। घडीले आफैँ पछ्याउँछ।",
    "Add a workplace on your phone first.": "पहिले फोनमा कार्यस्थल थप्नुहोस्।",
    "Saved on your watch · Syncing when connected": "घडीमा सुरक्षित · जोडिएपछि सिङ्क हुन्छ",
    "Try again": "फेरि प्रयास गर्नुहोस्",
    "Something went wrong. Please try again.": "केही समस्या भयो। कृपया फेरि प्रयास गर्नुहोस्।",
    "Something went wrong on our side. Please try again.": "हाम्रोतर्फ समस्या भयो। कृपया फेरि प्रयास गर्नुहोस्।",
    "We couldn't connect. Check your internet and try again.": "जोडिन सकेनौँ। इन्टरनेट जाँचेर फेरि प्रयास गर्नुहोस्।",
    "Too many tries. Wait a minute, then try again.": "धेरै पटक प्रयास भयो। एक मिनेट पर्खेर फेरि प्रयास गर्नुहोस्।",
    "This week": "यो हप्ता",
    "{used} of {cap}": "{cap} मध्ये {used}",
    "{time} left": "{time} बाँकी",
    "{time} over": "{time} बढी",
    "Weekly limit": "हप्ताको सीमा",
    "Fortnightly limit": "पन्ध्र दिनको सीमा",
    "Monthly limit": "महिनाको सीमा",
    "No hours limit set": "घण्टा सीमा राखिएको छैन",
    "Resets {day}": "{day} मा फेरि सुरु",
  ]

  static func tr(_ text: String, _ vars: [String: String] = [:]) -> String {
    var sentence = lang == "ne" ? (ne[text] ?? text) : text
    for (name, value) in vars { sentence = sentence.replacingOccurrences(of: "{\(name)}", with: value) }
    return sentence
  }
}

func tr(_ text: String, _ vars: [String: String] = [:]) -> String { Words.tr(text, vars) }
