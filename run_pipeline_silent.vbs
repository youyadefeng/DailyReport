Set shell = CreateObject("WScript.Shell")
currentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & currentDir & "\run_pipeline.bat" & Chr(34), 0, False
