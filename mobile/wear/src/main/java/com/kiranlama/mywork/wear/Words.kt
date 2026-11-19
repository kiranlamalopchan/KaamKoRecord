package com.kiranlama.mywork.wear

/**
 * The watch in English or in Nepali — whichever the phone is set to.
 *
 * As on the phone (src/i18n), the English sentence is the key and a sentence
 * with no Nepali yet stays in English. Keep this list in step with the Apple
 * Watch app's Words.swift and, where a sentence is shared, with the phone's ne.ts.
 */
object Words {
  @Volatile var lang: String = "en"

  private val ne = mapOf(
    "Clock in" to "क्लक इन",
    "Clock out" to "क्लक आउट",
    "Clock out?" to "क्लक आउट गर्ने?",
    "Start break" to "ब्रेक सुरु",
    "End break" to "ब्रेक सकियो",
    "Working" to "काम गर्दै",
    "On break" to "ब्रेकमा",
    "Cancel" to "रद्द गर्नुहोस्",
    "Workplace" to "कार्यस्थल",
    "Since {time}" to "{time} देखि",
    "Break since {time}" to "{time} देखि ब्रेकमा",
    "Worked {time}" to "{time} काम",
    "Sign in on your phone" to "फोनमा साइन इन गर्नुहोस्",
    "Open KaamKoRecord on your phone and sign in. Your watch follows." to "फोनमा KaamKoRecord खोलेर साइन इन गर्नुहोस्। घडीले आफैँ पछ्याउँछ।",
    "Add a workplace on your phone first." to "पहिले फोनमा कार्यस्थल थप्नुहोस्।",
    "Saved on your watch · Syncing when connected" to "घडीमा सुरक्षित · जोडिएपछि सिङ्क हुन्छ",
    "Try again" to "फेरि प्रयास गर्नुहोस्",
    "Something went wrong. Please try again." to "केही समस्या भयो। कृपया फेरि प्रयास गर्नुहोस्।",
    "Something went wrong on our side. Please try again." to "हाम्रोतर्फ समस्या भयो। कृपया फेरि प्रयास गर्नुहोस्।",
    "We couldn't connect. Check your internet and try again." to "जोडिन सकेनौँ। इन्टरनेट जाँचेर फेरि प्रयास गर्नुहोस्।",
    "Too many tries. Wait a minute, then try again." to "धेरै पटक प्रयास भयो। एक मिनेट पर्खेर फेरि प्रयास गर्नुहोस्।",
    "Work" to "काम",
    "Break" to "ब्रेक",
    "Off" to "बन्द",
    "Off shift" to "सिफ्टमा छैन",
    "This week" to "यो हप्ता",
    "{used} of {cap}" to "{cap} मध्ये {used}",
    "{time} left" to "{time} बाँकी",
    "{time} over" to "{time} बढी",
    "Weekly limit" to "हप्ताको सीमा",
    "Fortnightly limit" to "पन्ध्र दिनको सीमा",
    "Monthly limit" to "महिनाको सीमा",
    "No hours limit set" to "घण्टा सीमा राखिएको छैन",
    "Resets {day}" to "{day} मा फेरि सुरु",
    "Open KaamKoRecord on your watch once." to "घडीमा एक पटक KaamKoRecord खोल्नुहोस्।",
  )

  fun tr(text: String, vararg vars: Pair<String, String>): String {
    var sentence = if (lang == "ne") ne[text] ?: text else text
    for ((name, value) in vars) sentence = sentence.replace("{$name}", value)
    return sentence
  }
}

fun tr(text: String, vararg vars: Pair<String, String>) = Words.tr(text, *vars)
