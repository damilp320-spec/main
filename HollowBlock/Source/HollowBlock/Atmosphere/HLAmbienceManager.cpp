// Copyright Hollow Block. All Rights Reserved.

#include "Atmosphere/HLAmbienceManager.h"
#include "Atmosphere/HLAmbientEmitterComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"

UHLAmbienceManager* UHLAmbienceManager::Get(const UObject* WorldContext)
{
	if (const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContext, EGetWorldErrorMode::ReturnNull) : nullptr)
	{
		return World->GetSubsystem<UHLAmbienceManager>();
	}
	return nullptr;
}

void UHLAmbienceManager::RegisterEmitter(UHLAmbientEmitterComponent* Emitter)
{
	if (!Emitter)
	{
		return;
	}

	Emitters.AddUnique(Emitter);
	Emitter->SetIntensity(GlobalIntensity);
}

void UHLAmbienceManager::UnregisterEmitter(UHLAmbientEmitterComponent* Emitter)
{
	Emitters.RemoveAll([Emitter](const TWeakObjectPtr<UHLAmbientEmitterComponent>& Entry)
	{
		return !Entry.IsValid() || Entry.Get() == Emitter;
	});
}

void UHLAmbienceManager::SetGlobalIntensity(float InIntensity)
{
	GlobalIntensity = FMath::Clamp(InIntensity, 0.f, 1.f);

	for (int32 i = Emitters.Num() - 1; i >= 0; --i)
	{
		if (UHLAmbientEmitterComponent* Emitter = Emitters[i].Get())
		{
			Emitter->SetIntensity(GlobalIntensity);
		}
		else
		{
			Emitters.RemoveAtSwap(i);
		}
	}
}
