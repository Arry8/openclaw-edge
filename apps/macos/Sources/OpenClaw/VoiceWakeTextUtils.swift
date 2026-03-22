import Foundation
import SwabbleKit

enum VoiceWakeTextUtils {
    private static let whitespaceAndPunctuation = CharacterSet.whitespacesAndNewlines
        .union(.punctuationCharacters)
    typealias TrimWake = (String, [String]) -> String

    static func normalizeToken(_ token: String) -> String {
        token
            .trimmingCharacters(in: self.whitespaceAndPunctuation)
            .lowercased()
    }

    static func startsWithTrigger(transcript: String, triggers: [String]) -> Bool {
        let tokens = transcript
            .split(whereSeparator: { $0.isWhitespace })
            .map { self.normalizeToken(String($0)) }
            .filter { !$0.isEmpty }
        guard !tokens.isEmpty else { return false }
        for trigger in triggers {
            let triggerTokens = trigger
                .split(whereSeparator: { $0.isWhitespace })
                .map { self.normalizeToken(String($0)) }
                .filter { !$0.isEmpty }
            guard !triggerTokens.isEmpty, tokens.count >= triggerTokens.count else { continue }
            if zip(triggerTokens, tokens.prefix(triggerTokens.count)).allSatisfy({ $0 == $1 }) {
                return true
            }
        }
        return false
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
        let transcriptTokens = transcript
            .split(whereSeparator: { $0.isWhitespace })
            .map { self.normalizeToken(String($0)) }
            .filter { !$0.isEmpty }
        guard !transcriptTokens.isEmpty else { return nil }

        var bestStartIndex = Int.max
        var bestTokenCount = -1
        var bestTokens: [String]?

        for trigger in triggers {
            let triggerTokens = trigger
                .split(whereSeparator: { $0.isWhitespace })
                .map { self.normalizeToken(String($0)) }
                .filter { !$0.isEmpty }
            guard !triggerTokens.isEmpty, transcriptTokens.count >= triggerTokens.count else { continue }
            for index in 0...(transcriptTokens.count - triggerTokens.count) {
                let candidate = transcriptTokens[index..<(index + triggerTokens.count)]
                guard zip(triggerTokens, candidate).allSatisfy({ $0 == $1 }) else { continue }
                if index < bestStartIndex || (index == bestStartIndex && triggerTokens.count > bestTokenCount) {
                    bestStartIndex = index
                    bestTokenCount = triggerTokens.count
                    bestTokens = triggerTokens
                }
            }
        }

        return bestTokens?.joined(separator: " ")
    }
}
