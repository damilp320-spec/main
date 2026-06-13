// Copyright Hollow Block. All Rights Reserved.

#include "Core/HLTensionDirector.h"
#include "Atmosphere/HLAmbienceManager.h"
#include "AI/HLPresenceActor.h"
#include "Engine/Engine.h"
#include "Engine/World.h"

UHLTensionDirector* UHLTensionDirector::Get(const UObject* WorldContext)
{
	if (const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContext, EGetWorldErrorMode::ReturnNull) : nullptr)
	{
		return World->GetSubsystem<UHLTensionDirector>();
	}
	return nullptr;
}

void UHLTensionDirector::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	CachedAmbience = InWorld.GetSubsystem<UHLAmbienceManager>();
	UpdateAmbience();
}

TStatId UHLTensionDirector::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UHLTensionDirector, STATGROUP_Tickables);
}

void UHLTensionDirector::AddTension(float Amount)
{
	Tension = FMath::Clamp(Tension + Amount, 0.f, 1.f);
}

void UHLTensionDirector::Tick(float DeltaTime)
{
	// Passive rise minus decay: net drift upward but punctuated by calm recovery.
	Tension = FMath::Clamp(Tension + (PassiveRisePerSecond - DecayPerSecond) * DeltaTime, 0.f, 1.f);

	UpdateAmbience();
	UpdatePresenceWindow(DeltaTime);

	if (!FMath::IsNearlyEqual(LastBroadcastTension, Tension, 0.01f))
	{
		LastBroadcastTension = Tension;
		OnTensionChanged.Broadcast(Tension);
	}
}

void UHLTensionDirector::UpdateAmbience()
{
	if (UHLAmbienceManager* Ambience = CachedAmbience.Get())
	{
		// As tension climbs, the lived-in soundscape recedes — quiet but wrong.
		const float Intensity = FMath::Lerp(1.f, 0.35f, Tension);
		Ambience->SetGlobalIntensity(Intensity);
	}
}

void UHLTensionDirector::UpdatePresenceWindow(float DeltaTime)
{
	AHLPresenceActor* P = Presence.Get();
	if (!P)
	{
		return;
	}

	PresenceCooldown = FMath::Max(0.f, PresenceCooldown - DeltaTime);

	if (Tension >= PresenceThreshold && PresenceCooldown <= 0.f)
	{
		// Open an appearance window; the presence decides placement/visibility.
		P->OpenAppearanceWindow(Tension);
		// Higher tension => windows reopen sooner.
		PresenceCooldown = FMath::Lerp(45.f, 15.f, Tension);
	}
}
