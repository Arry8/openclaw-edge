import Foundation
import SwabbleKit

enum VoiceWakeTextUtils {
    private static let whitespaceAndPunctuation = CharacterSet.whitespacesAndNewlines
        .union(.punctuationCharacters)
        .union(.symbols)
    private static let triggerOnlyLeadInTokens: Set<String> = [
        "ah",
        "eh",
        "er",
        "erm",
        "hello",
        "hey",
        "hi",
        "hmm",
        "mm",
        "oh",
        "uh",
        "um",
        "yo",
        "啊",
        "哎",
        "嘿",
        "喂",
        "嗨",
        "呀",
    ]
    typealias TrimWake = (String, [String]) -> String

    static func normalizeToken(_ token: String) -> String {
        token
            .trimmingCharacters(in: self.whitespaceAndPunctuation)
            .lowercased()
    }

    static func startsWithTrigger(transcript: String, triggers: [String]) -> Bool {
        self.bestTriggerMatch(transcript: transcript, triggers: triggers)?.startIndex == 0
    }

    static func hasTriggerOnlyLeadIn(transcript: String, triggers: [String]) -> Bool {
        guard let match = self.bestTriggerMatch(transcript: transcript, triggers: triggers) else {
            return false
        }
        return match.prefixTokens.allSatisfy { self.triggerOnlyLeadInTokens.contains($0) }
    }

    static func textOnlyCommand(
        transcript: String,
        triggers: [String],
        minCommandLength: Int,
        trimWake: TrimWake) -> String?
    {
        guard !transcript.isEmpty else { return nil }
        guard !self.normalizeToken(transcript).isEmpty else { return nil }
        guard WakeWordGate.matchesTextOnly(text: transcript, triggers: triggers) else { return nil }
        guard self.startsWithTrigger(transcript: transcript, triggers: triggers) else { return nil }
        let trimmed = trimWake(transcript, triggers)
        guard trimmed.count >= minCommandLength else { return nil }
        return trimmed
    }

    static func matchedTriggerWord(transcript: String, triggers: [String]) -> String? {
        self.bestTriggerMatch(transcript: transcript, triggers: triggers)?.trigger
    }

    private static func bestTriggerMatch(
        transcript: String,
        triggers: [String]) -> (trigger: String, startIndex: Int, prefixTokens: [String])?
    {
        let normalizedTranscript = self.normalizeComparableText(transcript)
        guard !normalizedTranscript.isEmpty else { return nil }

        var best: (trigger: String, startIndex: Int, prefixTokens: [String])?

        for trigger in triggers {
            let normalizedTrigger = self.normalizeComparableText(trigger)
            guard !normalizedTrigger.isEmpty else { continue }
            guard let range = normalizedTranscript.range(of: normalizedTrigger) else { continue }
            let startIndex = normalizedTranscript.distance(
                from: normalizedTranscript.startIndex,
                to: range.lowerBound)
            let prefixTokens = normalizedTranscript[..<range.lowerBound]
                .split(separator: " ")
                .map(String.init)
            if let best {
                if startIndex > best.startIndex {
                    continue
                }
                if startIndex == best.startIndex, normalizedTrigger.count <= best.trigger.count {
                    continue
                }
            }
            best = (normalizedTrigger, startIndex, prefixTokens)
        }

        return best
    }

    private static func normalizeComparableText(_ text: String) -> String {
        let folded = text.folding(
            options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
            locale: nil)
        var output = ""
        output.reserveCapacity(folded.count)
        var previousWasSeparator = false
        for scalar in folded.unicodeScalars {
            if self.whitespaceAndPunctuation.contains(scalar) {
                if !previousWasSeparator {
                    output.append(" ")
                }
                previousWasSeparator = true
            } else {
                output.append(String(scalar))
                previousWasSeparator = false
            }
        }
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
