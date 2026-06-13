// Copyright Hollow Block. All Rights Reserved.

using UnrealBuildTool;
using System.Collections.Generic;

public class HollowBlockTarget : TargetRules
{
	public HollowBlockTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_3;
		ExtraModuleNames.Add("HollowBlock");
	}
}
