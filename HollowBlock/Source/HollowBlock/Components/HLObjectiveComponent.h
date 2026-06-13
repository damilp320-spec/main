// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "HLObjectiveComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnObjectiveChanged, const FText&, CurrentObjective);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnAllObjectivesComplete);

/**
 * Tracks an ordered list of objectives ("Find the stairwell key", "Restore power",
 * "Reach the rooftop"). The HUD shows the current objective; gameplay actors call
 * CompleteCurrentObjective() (e.g. a door opening, an item picked up) to advance.
 * The TensionDirector reads completed-count / total to scale dread over the run.
 */
UCLASS(ClassGroup = (HollowBlock), meta = (BlueprintSpawnableComponent))
class HOLLOWBLOCK_API UHLObjectiveComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UHLObjectiveComponent();

	/** Advance to the next objective. Broadcasts change, or completion if it was the last. */
	UFUNCTION(BlueprintCallable, Category = "Objectives")
	void CompleteCurrentObjective();

	/** Identifier-based completion: only advances if it matches the current objective's tag. */
	UFUNCTION(BlueprintCallable, Category = "Objectives")
	bool CompleteObjectiveByTag(FName Tag);

	UFUNCTION(BlueprintPure, Category = "Objectives")
	FText GetCurrentObjectiveText() const;

	UFUNCTION(BlueprintPure, Category = "Objectives")
	int32 GetCurrentObjectiveIndex() const { return CurrentIndex; }

	UFUNCTION(BlueprintPure, Category = "Objectives")
	float GetProgressFraction() const;

	UFUNCTION(BlueprintPure, Category = "Objectives")
	bool IsComplete() const { return CurrentIndex >= Objectives.Num(); }

	UPROPERTY(BlueprintAssignable, Category = "Objectives")
	FOnObjectiveChanged OnObjectiveChanged;

	UPROPERTY(BlueprintAssignable, Category = "Objectives")
	FOnAllObjectivesComplete OnAllObjectivesComplete;

protected:
	virtual void BeginPlay() override;

	/** Optional stable tags aligned by index with Objectives, used by CompleteObjectiveByTag. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Objectives")
	TArray<FName> ObjectiveTags;

	/** The ordered objective strings shown to the player. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Objectives")
	TArray<FText> Objectives;

private:
	int32 CurrentIndex = 0;
};
