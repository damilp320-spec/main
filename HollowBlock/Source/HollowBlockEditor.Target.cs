// Copyright Hollow Block. All Rights Reserved.

using UnrealBuildTool;
using System.Collections.Generic;

public class HollowBlockEditorTarget : TargetRules
{
	public HollowBlockEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_3;
		ExtraModuleNames.Add("HollowBlock");
	}
}
