# Two-minute localhost demonstration

Record one continuous take with voiceover. Open the running dashboard before recording. Use a held-out issue week in 2025, keep one city and ward selected, and stop at 2:00. Speak the numbers actually displayed.

| Time | Action | Voiceover |
|---|---|---|
| 0:00 to 0:17 | Show Public view, selected ward and issue week. | “Which wards need closer monitoring in the coming weeks? This dashboard replays a forecast using only the observations available at the selected date. The dataset ends in December 2025.” |
| 0:17 to 0:42 | Read the two-week target date, predicted cases and tier. Switch to four weeks and point out the new date and estimate. | “For this ward the two-week estimate is [read value] cases. Four weeks ahead it is [read value]. The band shows uncertainty. The tier describes case burden relative to the historical training period.” |
| 0:42 to 1:07 | Open Officer view. Select a priority ward and show its rainfall history. | “The officer can use this ranking to choose a ward for review. Rain in earlier weeks, recent cases and local conditions feed the forecast. Each ward's lagged features come from its own history.” |
| 1:07 to 1:21 | Open Hospital view and compare horizons. | “A hospital can compare expected case burden across the next few weeks. The dataset contains no admissions or bed-use figures.” |
| 1:21 to 1:49 | Open Model Performance. Point to the two-week model and baseline. | “Training targets end in 2022. We chose the model on 2023 data and evaluated it on later weeks. Two weeks ahead, average absolute error was 1.04 cases per ward-week. Repeating the last count gave 1.69.” |
| 1:49 to 2:00 | Return to the ward forecast and its issue date. | “The saved model runs locally. The API reuses forecasts for the same week and horizon. This is a historical replay for planning.” |
