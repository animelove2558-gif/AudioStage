; AudioStage installer additions (electron-builder nsis.include).
; .asession files are associated through build.fileAssociations (package.json). Audio files are only *offered*:
; AudioStage is added to their "Open with" list (OpenWithProgids + Applications\AudioStage.exe\SupportedTypes)
; without becoming the default program, so the user's choice for .wav / .mp3 … stays untouched.

!macro AS_AUDIO_EXT EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "AudioStage.Audio" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
!macroend
!macro AS_AUDIO_EXT_REMOVE EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "AudioStage.Audio"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\AudioStage.Audio" "" "Audio file"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AudioStage.Audio" "FriendlyTypeName" "Audio file"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AudioStage.Audio\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AudioStage.Audio\shell\open" "FriendlyAppName" "AudioStage"
  WriteRegStr SHELL_CONTEXT "Software\Classes\AudioStage.Audio\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "AudioStage"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro AS_AUDIO_EXT "wav"
  !insertmacro AS_AUDIO_EXT "mp3"
  !insertmacro AS_AUDIO_EXT "flac"
  !insertmacro AS_AUDIO_EXT "ogg"
  !insertmacro AS_AUDIO_EXT "opus"
  !insertmacro AS_AUDIO_EXT "m4a"
  !insertmacro AS_AUDIO_EXT "aac"
  !insertmacro AS_AUDIO_EXT "aif"
  !insertmacro AS_AUDIO_EXT "aiff"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  !insertmacro AS_AUDIO_EXT_REMOVE "wav"
  !insertmacro AS_AUDIO_EXT_REMOVE "mp3"
  !insertmacro AS_AUDIO_EXT_REMOVE "flac"
  !insertmacro AS_AUDIO_EXT_REMOVE "ogg"
  !insertmacro AS_AUDIO_EXT_REMOVE "opus"
  !insertmacro AS_AUDIO_EXT_REMOVE "m4a"
  !insertmacro AS_AUDIO_EXT_REMOVE "aac"
  !insertmacro AS_AUDIO_EXT_REMOVE "aif"
  !insertmacro AS_AUDIO_EXT_REMOVE "aiff"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\AudioStage.Audio"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
