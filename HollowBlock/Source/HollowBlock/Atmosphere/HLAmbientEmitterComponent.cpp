// Copyright Hollow Block. All Rights Reserved.

#include "Atmosphere/HLAmbientEmitterComponent.h"
#include "Atmosphere/HLAmbienceManager.h"
#include "Components/AudioComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"

UHLAmbientEmitterComponent::UHLAmbientEmitterComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickInterval = 0.1f;
}

void UHLAmbientEmitterComponent::BeginPlay()
{
	Super::BeginPlay();

	if (LoopingBed)
	{
		BedAudio = UGameplayStatics::SpawnSoundAttached(LoopingBed, this);
		if (BedAudio)
		{
			BedAudio->SetVolumeMultiplier(BedBaseVolume * Intensity);
		}
	}

	ScheduleNextOneShot();

	if (UHLAmbienceManager* Manager = UHLAmbienceManager::Get(this))
	{
		Manager->RegisterEmitter(this);
	}
}

void UHLAmbientEmitterComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UHLAmbienceManager* Manager = UHLAmbienceManager::Get(this))
	{
		Manager->UnregisterEmitter(this);
	}

	if (BedAudio)
	{
		BedAudio->Stop();
		BedAudio = nullptr;
	}

	Super::EndPlay(EndPlayReason);
}

void UHLAmbientEmitterComponent::SetIntensity(float InIntensity)
{
	Intensity = FMath::Clamp(InIntensity, 0.f, 1.f);
	if (BedAudio)
	{
		BedAudio->SetVolumeMultiplier(BedBaseVolume * Intensity);
	}
}

void UHLAmbientEmitterComponent::ScheduleNextOneShot()
{
	const float Lo = FMath::Min(MinInterval, MaxInterval);
	const float Hi = FMath::Max(MinInterval, MaxInterval);
	// Lower intensity => longer gaps between sounds (the block falls quieter).
	const float IntensityFactor = FMath::Lerp(2.5f, 1.f, Intensity);
	OneShotCountdown = FMath::FRandRange(Lo, Hi) * IntensityFactor;
}

void UHLAmbientEmitterComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (OneShots.Num() == 0 || Intensity <= 0.f)
	{
		return;
	}

	OneShotCountdown -= DeltaTime;
	if (OneShotCountdown <= 0.f)
	{
		const int32 Index = FMath::RandRange(0, OneShots.Num() - 1);
		if (USoundBase* Sound = OneShots[Index])
		{
			UGameplayStatics::SpawnSoundAtLocation(this, Sound, GetComponentLocation(), FRotator::ZeroRotator, Intensity);
		}
		ScheduleNextOneShot();
	}
}
